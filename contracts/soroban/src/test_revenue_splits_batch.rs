#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    token::Client as TokenClient,
    token::StellarAssetClient,
    vec, Address, Env, Error, Vec,
};

const AMOUNT: i128 = 100_0000000;
const INTERVAL: u64 = 30 * 24 * 60 * 60;

/// Contract, token and merchant with auths mocked. Ledger time starts at 1_000.
fn setup(env: &Env) -> (OrbitContractClient<'_>, Address, Address) {
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let contract_id = env.register(OrbitContract, ());
    let merchant = Address::generate(env);
    (OrbitContractClient::new(env, &contract_id), token, merchant)
}

/// A funded subscriber with an approved vault billing `amount` per interval.
fn subscribe(
    env: &Env,
    orbit: &OrbitContractClient,
    token: &Address,
    merchant: &Address,
    amount: i128,
) -> Address {
    let user = Address::generate(env);
    StellarAssetClient::new(env, token).mint(&user, &(amount * 10));
    TokenClient::new(env, token).approve(&user, &orbit.address, &(amount * 10), &2_000_000);
    orbit.create_vault(&user, merchant, token, &amount, &INTERVAL);
    user
}

fn split(recipient: &Address, bps: u32) -> RevenueSplit {
    RevenueSplit {
        recipient: recipient.clone(),
        bps,
    }
}

fn is_contract_error<T: std::fmt::Debug>(
    res: &Result<Result<T, soroban_sdk::ConversionError>, Result<Error, soroban_sdk::InvokeError>>,
    expected: OrbitContractError,
) -> bool {
    matches!(res, Err(Ok(e)) if *e == Error::from_contract_error(expected as u32))
}

// ----------------------------------------------------------------------------
// REVENUE SPLITS (#363)
// ----------------------------------------------------------------------------

#[test]
fn test_two_way_split_pays_each_cofounder_directly() {
    let env = Env::default();
    let (orbit, token, merchant) = setup(&env);
    let tokens = TokenClient::new(&env, &token);
    let (alice, bob) = (Address::generate(&env), Address::generate(&env));
    orbit.set_revenue_splits(
        &merchant,
        &vec![&env, split(&alice, 6_000), split(&bob, 4_000)],
    );
    let user = subscribe(&env, &orbit, &token, &merchant, AMOUNT);

    orbit.pull_funds(&user, &merchant);

    assert_eq!(tokens.balance(&alice), 60_0000000);
    assert_eq!(tokens.balance(&bob), 40_0000000);
    assert_eq!(tokens.balance(&merchant), 0);
    assert_eq!(tokens.balance(&orbit.address), 0);
    assert_eq!(tokens.balance(&user), AMOUNT * 10 - AMOUNT);
    // The vault still records the full settled amount.
    assert_eq!(
        orbit
            .get_vault(&user, &merchant)
            .unwrap()
            .total_pulled_amount,
        AMOUNT
    );
}

#[test]
fn test_three_way_split_including_the_merchant() {
    let env = Env::default();
    let (orbit, token, merchant) = setup(&env);
    let tokens = TokenClient::new(&env, &token);
    let (alice, bob) = (Address::generate(&env), Address::generate(&env));
    orbit.set_revenue_splits(
        &merchant,
        &vec![
            &env,
            split(&merchant, 5_000),
            split(&alice, 3_000),
            split(&bob, 2_000),
        ],
    );
    let user = subscribe(&env, &orbit, &token, &merchant, AMOUNT);

    orbit.pull_funds(&user, &merchant);

    assert_eq!(tokens.balance(&merchant), 50_0000000);
    assert_eq!(tokens.balance(&alice), 30_0000000);
    assert_eq!(tokens.balance(&bob), 20_0000000);
}

#[test]
fn test_rounding_remainder_goes_to_last_recipient_and_conserves_funds() {
    let env = Env::default();
    let (orbit, token, merchant) = setup(&env);
    let tokens = TokenClient::new(&env, &token);
    let (a, b, c) = (
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    );
    orbit.set_revenue_splits(
        &merchant,
        &vec![&env, split(&a, 3_333), split(&b, 3_333), split(&c, 3_334)],
    );
    // 10 base units cannot divide evenly three ways.
    let user = subscribe(&env, &orbit, &token, &merchant, 10);

    orbit.pull_funds(&user, &merchant);

    assert_eq!(tokens.balance(&a), 3);
    assert_eq!(tokens.balance(&b), 3);
    assert_eq!(tokens.balance(&c), 4);
    assert_eq!(
        tokens.balance(&a) + tokens.balance(&b) + tokens.balance(&c),
        10
    );
    assert_eq!(tokens.balance(&orbit.address), 0);
}

#[test]
fn test_split_shares_always_sum_to_the_amount() {
    let env = Env::default();
    let splits = vec![
        &env,
        split(&Address::generate(&env), 1),
        split(&Address::generate(&env), 4_999),
        split(&Address::generate(&env), 5_000),
    ];
    for amount in [1_i128, 7, 9_999, 10_001, 123_456_789, 29_0000000] {
        let shares = revenue_split_shares(&env, amount, &splits);
        assert_eq!(shares.iter().sum::<i128>(), amount, "amount {amount}");
        assert!(shares.iter().all(|s| s >= 0));
    }
}

#[test]
fn test_without_splits_the_merchant_receives_everything() {
    let env = Env::default();
    let (orbit, token, merchant) = setup(&env);
    let tokens = TokenClient::new(&env, &token);
    let user = subscribe(&env, &orbit, &token, &merchant, AMOUNT);

    assert_eq!(orbit.get_revenue_splits(&merchant).len(), 0);
    orbit.pull_funds(&user, &merchant);

    assert_eq!(tokens.balance(&merchant), AMOUNT);
}

#[test]
fn test_clearing_splits_falls_back_to_the_merchant() {
    let env = Env::default();
    let (orbit, token, merchant) = setup(&env);
    let tokens = TokenClient::new(&env, &token);
    let alice = Address::generate(&env);
    orbit.set_revenue_splits(&merchant, &vec![&env, split(&alice, 10_000)]);
    let user = subscribe(&env, &orbit, &token, &merchant, AMOUNT);

    orbit.pull_funds(&user, &merchant);
    assert_eq!(tokens.balance(&alice), AMOUNT);

    orbit.clear_revenue_splits(&merchant);
    env.ledger().with_mut(|l| l.timestamp += INTERVAL);
    orbit.pull_funds(&user, &merchant);

    assert_eq!(tokens.balance(&alice), AMOUNT);
    assert_eq!(tokens.balance(&merchant), AMOUNT);
}

#[test]
fn test_splits_are_stored_and_replaced() {
    let env = Env::default();
    let (orbit, _token, merchant) = setup(&env);
    let (alice, bob) = (Address::generate(&env), Address::generate(&env));

    let first = vec![&env, split(&alice, 5_000), split(&bob, 5_000)];
    orbit.set_revenue_splits(&merchant, &first);
    assert_eq!(orbit.get_revenue_splits(&merchant), first);

    let second = vec![&env, split(&bob, 10_000)];
    orbit.set_revenue_splits(&merchant, &second);
    assert_eq!(orbit.get_revenue_splits(&merchant), second);
}

#[test]
fn test_split_bps_must_total_exactly_10000() {
    let env = Env::default();
    let (orbit, _token, merchant) = setup(&env);
    let (alice, bob) = (Address::generate(&env), Address::generate(&env));

    let under = orbit.try_set_revenue_splits(
        &merchant,
        &vec![&env, split(&alice, 5_000), split(&bob, 4_999)],
    );
    assert!(is_contract_error(
        &under,
        OrbitContractError::RevenueSplitBpsMismatch
    ));

    let over = orbit.try_set_revenue_splits(
        &merchant,
        &vec![&env, split(&alice, 5_000), split(&bob, 5_001)],
    );
    assert!(is_contract_error(
        &over,
        OrbitContractError::RevenueSplitBpsMismatch
    ));

    assert_eq!(orbit.get_revenue_splits(&merchant).len(), 0);
}

#[test]
fn test_malformed_split_lists_are_rejected() {
    let env = Env::default();
    let (orbit, _token, merchant) = setup(&env);
    let (alice, bob) = (Address::generate(&env), Address::generate(&env));

    let empty = orbit.try_set_revenue_splits(&merchant, &Vec::new(&env));
    assert!(is_contract_error(
        &empty,
        OrbitContractError::InvalidRevenueSplit
    ));

    let zero = orbit.try_set_revenue_splits(
        &merchant,
        &vec![&env, split(&alice, 10_000), split(&bob, 0)],
    );
    assert!(is_contract_error(
        &zero,
        OrbitContractError::InvalidRevenueSplit
    ));

    let duplicate = orbit.try_set_revenue_splits(
        &merchant,
        &vec![&env, split(&alice, 5_000), split(&alice, 5_000)],
    );
    assert!(is_contract_error(
        &duplicate,
        OrbitContractError::InvalidRevenueSplit
    ));

    let mut too_many = Vec::new(&env);
    for _ in 0..=MAX_REVENUE_SPLITS {
        too_many.push_back(split(&Address::generate(&env), 1));
    }
    let long = orbit.try_set_revenue_splits(&merchant, &too_many);
    assert!(is_contract_error(
        &long,
        OrbitContractError::InvalidRevenueSplit
    ));
}

#[test]
fn test_split_pull_is_atomic_when_the_subscriber_cannot_pay() {
    let env = Env::default();
    let (orbit, token, merchant) = setup(&env);
    let tokens = TokenClient::new(&env, &token);
    let (alice, bob) = (Address::generate(&env), Address::generate(&env));
    orbit.set_revenue_splits(
        &merchant,
        &vec![&env, split(&alice, 6_000), split(&bob, 4_000)],
    );

    // Allowance covers alice's share but not bob's.
    let user = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&user, &(AMOUNT * 10));
    tokens.approve(&user, &orbit.address, &(AMOUNT / 2), &2_000_000);
    orbit.create_vault(&user, &merchant, &token, &AMOUNT, &INTERVAL);

    assert!(orbit.try_pull_funds(&user, &merchant).is_err());
    assert_eq!(tokens.balance(&alice), 0);
    assert_eq!(tokens.balance(&bob), 0);
    assert_eq!(tokens.balance(&user), AMOUNT * 10);
}

#[test]
fn test_batch_pull_applies_the_same_splits() {
    let env = Env::default();
    let (orbit, token, merchant) = setup(&env);
    let tokens = TokenClient::new(&env, &token);
    let (alice, bob) = (Address::generate(&env), Address::generate(&env));
    orbit.set_revenue_splits(
        &merchant,
        &vec![&env, split(&alice, 7_500), split(&bob, 2_500)],
    );
    let first = subscribe(&env, &orbit, &token, &merchant, AMOUNT);
    let second = subscribe(&env, &orbit, &token, &merchant, AMOUNT);

    let results = orbit.batch_pull_funds(&merchant, &vec![&env, first, second]);

    assert!(results.iter().all(|r| r.success));
    assert_eq!(tokens.balance(&alice), 150_0000000);
    assert_eq!(tokens.balance(&bob), 50_0000000);
    assert_eq!(tokens.balance(&merchant), 0);
}

// ----------------------------------------------------------------------------
// BATCH VAULT QUERIES (#362)
// ----------------------------------------------------------------------------

#[test]
fn test_get_vaults_batch_mixes_existing_expired_and_missing_vaults() {
    let env = Env::default();
    let (orbit, token, active_merchant) = setup(&env);
    let expired_merchant = Address::generate(&env);
    let missing_merchant = Address::generate(&env);

    let user = subscribe(&env, &orbit, &token, &active_merchant, AMOUNT);
    // A lifetime cap of one charge expires the vault after its first pull.
    orbit.create_vault_with_limits(
        &user,
        &expired_merchant,
        &token,
        &AMOUNT,
        &INTERVAL,
        &UNLIMITED_EXPIRATION_LEDGER,
        &AMOUNT,
    );
    orbit.pull_funds(&user, &expired_merchant);

    let vaults = orbit.get_vaults_batch(
        &user,
        &vec![
            &env,
            active_merchant.clone(),
            missing_merchant.clone(),
            expired_merchant.clone(),
        ],
    );

    assert_eq!(vaults.len(), 3);
    assert_eq!(
        vaults.get(0).unwrap(),
        orbit.get_vault(&user, &active_merchant)
    );
    assert_eq!(
        vaults.get(0).unwrap().unwrap().payment_status,
        PAYMENT_ACTIVE
    );
    assert_eq!(vaults.get(1).unwrap(), None);
    let expired = vaults.get(2).unwrap().unwrap();
    assert_eq!(expired.payment_status, PAYMENT_EXPIRED);
    assert_eq!(Some(expired), orbit.get_vault(&user, &expired_merchant));
}

#[test]
fn test_get_merchant_vaults_batch_preserves_input_order() {
    let env = Env::default();
    let (orbit, token, merchant) = setup(&env);
    let first = subscribe(&env, &orbit, &token, &merchant, AMOUNT);
    let stranger = Address::generate(&env);
    let second = subscribe(&env, &orbit, &token, &merchant, 5_0000000);

    let vaults = orbit.get_merchant_vaults_batch(
        &merchant,
        &vec![
            &env,
            second.clone(),
            stranger,
            first.clone(),
            second.clone(),
        ],
    );

    assert_eq!(vaults.len(), 4);
    assert_eq!(
        vaults.get(0).unwrap().unwrap().amount_per_interval,
        5_0000000
    );
    assert_eq!(vaults.get(1).unwrap(), None);
    assert_eq!(vaults.get(2).unwrap().unwrap().amount_per_interval, AMOUNT);
    // Duplicate inputs are answered positionally.
    assert_eq!(vaults.get(3).unwrap(), vaults.get(0).unwrap());
}

#[test]
fn test_batch_queries_accept_empty_input() {
    let env = Env::default();
    let (orbit, _token, merchant) = setup(&env);
    let user = Address::generate(&env);
    assert_eq!(orbit.get_vaults_batch(&user, &Vec::new(&env)).len(), 0);
    assert_eq!(
        orbit
            .get_merchant_vaults_batch(&merchant, &Vec::new(&env))
            .len(),
        0
    );
}

#[test]
fn test_batch_queries_are_read_only() {
    let env = Env::default();
    let (orbit, token, merchant) = setup(&env);
    let user = subscribe(&env, &orbit, &token, &merchant, AMOUNT);
    let before = orbit.get_vault(&user, &merchant);

    orbit.get_vaults_batch(&user, &vec![&env, merchant.clone()]);
    assert_eq!(env.events().all().events().len(), 0);
    orbit.get_merchant_vaults_batch(&merchant, &vec![&env, user.clone()]);
    assert_eq!(env.events().all().events().len(), 0);
    assert!(env.auths().is_empty());

    assert_eq!(orbit.get_vault(&user, &merchant), before);
}

#[test]
#[should_panic(expected = "batch size exceeds MAX_BATCH_VAULT_QUERY")]
fn test_get_vaults_batch_rejects_oversized_batches() {
    let env = Env::default();
    let (orbit, _token, _merchant) = setup(&env);
    let mut merchants = Vec::new(&env);
    for _ in 0..=MAX_BATCH_VAULT_QUERY {
        merchants.push_back(Address::generate(&env));
    }
    orbit.get_vaults_batch(&Address::generate(&env), &merchants);
}

#[test]
#[should_panic(expected = "batch size exceeds MAX_BATCH_VAULT_QUERY")]
fn test_get_merchant_vaults_batch_rejects_oversized_batches() {
    let env = Env::default();
    let (orbit, _token, merchant) = setup(&env);
    let mut users = Vec::new(&env);
    for _ in 0..=MAX_BATCH_VAULT_QUERY {
        users.push_back(Address::generate(&env));
    }
    orbit.get_merchant_vaults_batch(&merchant, &users);
}
