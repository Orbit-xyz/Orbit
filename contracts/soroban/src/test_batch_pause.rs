extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    token::Client as TokenClient,
    token::StellarAssetClient,
    Address, Env, Error, IntoVal,
};

// ----------------------------------------------------------------------------
// MERCHANT BATCH PAUSE / UNPAUSE (#353)
// ----------------------------------------------------------------------------

const AMOUNT: i128 = 10_0000000;
const INTERVAL: u64 = 86_400;
const START: u64 = 1_000;
const FUNDS: i128 = 10_000_000_000;

/// Deploys the Orbit contract and a Stellar asset token, and returns the
/// contract id, token address and a merchant. Ledger time starts at `START`.
fn setup(env: &Env) -> (Address, Address, Address) {
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = START);

    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let contract_id = env.register(OrbitContract, ());
    let merchant = Address::generate(env);
    (contract_id, token, merchant)
}

/// Creates a funded subscriber with an active vault for `merchant`.
fn subscribe(env: &Env, contract_id: &Address, token: &Address, merchant: &Address) -> Address {
    let user = Address::generate(env);
    StellarAssetClient::new(env, token).mint(&user, &FUNDS);
    TokenClient::new(env, token).approve(&user, contract_id, &FUNDS, &2_000_000);
    OrbitContractClient::new(env, contract_id)
        .create_vault(&user, merchant, token, &AMOUNT, &INTERVAL);
    user
}

/// True when `res` is the contract error `VaultPaused`.
fn is_vault_paused<T: std::fmt::Debug>(
    res: &Result<Result<T, soroban_sdk::ConversionError>, Result<Error, soroban_sdk::InvokeError>>,
) -> bool {
    matches!(
        res,
        Err(Ok(e)) if *e == Error::from_contract_error(OrbitContractError::VaultPaused as u32)
    )
}

#[test]
fn test_batch_pause_freezes_every_listed_vault_and_pulls_revert_with_vault_paused() {
    let env = Env::default();
    let (contract_id, token, merchant) = setup(&env);
    let orbit = OrbitContractClient::new(&env, &contract_id);
    let sub_a = subscribe(&env, &contract_id, &token, &merchant);
    let sub_b = subscribe(&env, &contract_id, &token, &merchant);
    let subs = Vec::from_array(&env, [sub_a.clone(), sub_b.clone()]);

    assert_eq!(orbit.batch_pause_vaults(&merchant, &subs), 2);

    env.ledger().with_mut(|l| l.timestamp = START + INTERVAL);
    for sub in [&sub_a, &sub_b] {
        let res = orbit.try_pull_funds(sub, &merchant);
        assert!(is_vault_paused(&res), "pull on a frozen vault must revert");
    }
    assert_eq!(TokenClient::new(&env, &token).balance(&merchant), 0);
}

#[test]
fn test_frozen_vaults_are_skipped_by_batch_pull_without_moving_funds() {
    let env = Env::default();
    let (contract_id, token, merchant) = setup(&env);
    let orbit = OrbitContractClient::new(&env, &contract_id);
    let frozen = subscribe(&env, &contract_id, &token, &merchant);
    let live = subscribe(&env, &contract_id, &token, &merchant);

    orbit.batch_pause_vaults(&merchant, &Vec::from_array(&env, [frozen.clone()]));

    env.ledger().with_mut(|l| l.timestamp = START + INTERVAL);
    let results = orbit.batch_pull_funds(
        &merchant,
        &Vec::from_array(&env, [frozen.clone(), live.clone()]),
    );

    assert!(!results.get(0).unwrap().success);
    assert!(results.get(1).unwrap().success);
    // Only the live subscriber was billed.
    assert_eq!(TokenClient::new(&env, &token).balance(&merchant), AMOUNT);
}

#[test]
fn test_batch_unpause_restores_pull_eligibility() {
    let env = Env::default();
    let (contract_id, token, merchant) = setup(&env);
    let orbit = OrbitContractClient::new(&env, &contract_id);
    let sub = subscribe(&env, &contract_id, &token, &merchant);
    let subs = Vec::from_array(&env, [sub.clone()]);

    orbit.batch_pause_vaults(&merchant, &subs);
    env.ledger().with_mut(|l| l.timestamp = START + INTERVAL);
    assert!(is_vault_paused(&orbit.try_pull_funds(&sub, &merchant)));

    assert_eq!(orbit.batch_unpause_vaults(&merchant, &subs), 1);
    assert!(orbit.try_pull_funds(&sub, &merchant).is_ok());
    assert_eq!(TokenClient::new(&env, &token).balance(&merchant), AMOUNT);
}

#[test]
fn test_frozen_vault_is_not_reported_as_active_subscriber() {
    let env = Env::default();
    let (contract_id, token, merchant) = setup(&env);
    let orbit = OrbitContractClient::new(&env, &contract_id);
    let sub = subscribe(&env, &contract_id, &token, &merchant);

    assert!(orbit.is_subscriber_active(&sub, &merchant));
    orbit.batch_pause_vaults(&merchant, &Vec::from_array(&env, [sub.clone()]));
    assert!(!orbit.is_subscriber_active(&sub, &merchant));
    orbit.batch_unpause_vaults(&merchant, &Vec::from_array(&env, [sub.clone()]));
    assert!(orbit.is_subscriber_active(&sub, &merchant));
}

#[test]
fn test_merchant_cannot_freeze_another_merchants_subscriber() {
    let env = Env::default();
    let (contract_id, token, merchant_a) = setup(&env);
    let orbit = OrbitContractClient::new(&env, &contract_id);
    let sub_of_a = subscribe(&env, &contract_id, &token, &merchant_a);
    let merchant_b = Address::generate(&env);

    // Merchant B is authorized, but it has no vault with this subscriber.
    let res = orbit.try_batch_pause_vaults(&merchant_b, &Vec::from_array(&env, [sub_of_a.clone()]));
    assert!(res.is_err());

    env.ledger().with_mut(|l| l.timestamp = START + INTERVAL);
    assert!(orbit.try_pull_funds(&sub_of_a, &merchant_a).is_ok());
}

#[test]
fn test_unauthorized_caller_cannot_freeze_a_merchants_vaults() {
    let env = Env::default();
    let (contract_id, token, merchant) = setup(&env);
    let orbit = OrbitContractClient::new(&env, &contract_id);
    let sub = subscribe(&env, &contract_id, &token, &merchant);
    let subs = Vec::from_array(&env, [sub.clone()]);
    let attacker = Address::generate(&env);

    // The attacker signs, but the merchant argument must authorize the batch.
    let res = orbit
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "batch_pause_vaults",
                args: (&merchant, &subs).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_batch_pause_vaults(&merchant, &subs);
    assert!(res.is_err());

    env.ledger().with_mut(|l| l.timestamp = START + INTERVAL);
    assert!(orbit.try_pull_funds(&sub, &merchant).is_ok());
}

#[test]
fn test_batch_is_atomic_when_one_subscriber_has_no_vault() {
    let env = Env::default();
    let (contract_id, token, merchant) = setup(&env);
    let orbit = OrbitContractClient::new(&env, &contract_id);
    let sub = subscribe(&env, &contract_id, &token, &merchant);
    let stranger = Address::generate(&env);
    let subs = Vec::from_array(&env, [sub.clone(), stranger]);

    assert!(orbit.try_batch_pause_vaults(&merchant, &subs).is_err());

    // The valid vault in the same batch must not have been frozen.
    env.ledger().with_mut(|l| l.timestamp = START + INTERVAL);
    assert!(orbit.try_pull_funds(&sub, &merchant).is_ok());
}

#[test]
fn test_subscriber_resume_does_not_lift_a_merchant_freeze() {
    let env = Env::default();
    let (contract_id, token, merchant) = setup(&env);
    let orbit = OrbitContractClient::new(&env, &contract_id);
    let sub = subscribe(&env, &contract_id, &token, &merchant);

    orbit.batch_pause_vaults(&merchant, &Vec::from_array(&env, [sub.clone()]));
    orbit.pause_vault(&sub, &merchant);
    orbit.resume_vault(&sub, &merchant);

    env.ledger().with_mut(|l| l.timestamp = START + INTERVAL);
    assert!(is_vault_paused(&orbit.try_pull_funds(&sub, &merchant)));
}

#[test]
fn test_merchant_unfreeze_does_not_lift_a_subscriber_pause() {
    let env = Env::default();
    let (contract_id, token, merchant) = setup(&env);
    let orbit = OrbitContractClient::new(&env, &contract_id);
    let sub = subscribe(&env, &contract_id, &token, &merchant);
    let subs = Vec::from_array(&env, [sub.clone()]);

    orbit.pause_vault(&sub, &merchant);
    orbit.batch_pause_vaults(&merchant, &subs);
    orbit.batch_unpause_vaults(&merchant, &subs);

    env.ledger().with_mut(|l| l.timestamp = START + INTERVAL);
    assert!(is_vault_paused(&orbit.try_pull_funds(&sub, &merchant)));
}

#[test]
fn test_unfreeze_does_not_back_bill_the_frozen_period() {
    let env = Env::default();
    let (contract_id, token, merchant) = setup(&env);
    let orbit = OrbitContractClient::new(&env, &contract_id);
    let sub = subscribe(&env, &contract_id, &token, &merchant);
    let subs = Vec::from_array(&env, [sub.clone()]);

    // Settle one cycle, then the merchant freezes during an outage.
    orbit.pull_funds(&sub, &merchant);
    orbit.batch_pause_vaults(&merchant, &subs);

    // Service returns two intervals later.
    let resume_at = START + 3 * INTERVAL;
    env.ledger().with_mut(|l| l.timestamp = resume_at);
    orbit.batch_unpause_vaults(&merchant, &subs);
    assert_eq!(
        orbit
            .get_vault(&sub, &merchant)
            .unwrap()
            .last_pull_timestamp,
        resume_at
    );

    // No immediate catch-up billing for the frozen cycles.
    assert!(orbit.try_pull_funds(&sub, &merchant).is_err());

    env.ledger()
        .with_mut(|l| l.timestamp = resume_at + INTERVAL);
    orbit.pull_funds(&sub, &merchant);
    assert_eq!(
        TokenClient::new(&env, &token).balance(&merchant),
        2 * AMOUNT
    );
}

#[test]
fn test_oversized_or_empty_batches_are_rejected() {
    let env = Env::default();
    let (contract_id, _token, merchant) = setup(&env);
    let orbit = OrbitContractClient::new(&env, &contract_id);

    assert!(orbit
        .try_batch_pause_vaults(&merchant, &Vec::new(&env))
        .is_err());

    let mut many = Vec::new(&env);
    for _ in 0..(MAX_BATCH_PULL_SUBSCRIBERS + 1) {
        many.push_back(Address::generate(&env));
    }
    assert!(orbit.try_batch_pause_vaults(&merchant, &many).is_err());
    assert!(orbit.try_batch_unpause_vaults(&merchant, &many).is_err());
}

#[test]
fn test_cancelling_a_frozen_vault_clears_the_freeze() {
    let env = Env::default();
    let (contract_id, token, merchant) = setup(&env);
    let orbit = OrbitContractClient::new(&env, &contract_id);
    let sub = subscribe(&env, &contract_id, &token, &merchant);

    orbit.batch_pause_vaults(&merchant, &Vec::from_array(&env, [sub.clone()]));
    orbit.cancel_vault(&sub, &merchant);

    // A fresh vault for the same pair must not inherit the old freeze.
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&sub, &FUNDS);
    TokenClient::new(&env, &token).approve(&sub, &contract_id, &FUNDS, &2_000_000);
    orbit.create_vault(&sub, &merchant, &token, &AMOUNT, &INTERVAL);
    assert!(orbit.get_vault(&sub, &merchant).is_some());
    assert!(orbit.is_subscriber_active(&sub, &merchant));

    env.ledger().with_mut(|l| l.timestamp = START + INTERVAL);
    assert!(orbit.try_pull_funds(&sub, &merchant).is_ok());
}
