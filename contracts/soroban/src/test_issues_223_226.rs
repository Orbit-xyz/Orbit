#![cfg(test)]

//! Regression tests for issues #223-#226:
//!   #223 emergency pause + timelocked circuit breaker
//!   #224 protocol treasury fee split during `batch_disburse`
//!   #225 milestone-based escrow with dispute arbiter
//!   #226 sliding-window allowance rate limits

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, IntoVal, Vec,
};

struct Fixture<'a> {
    env: Env,
    orbit: OrbitContractClient<'a>,
    token: Address,
    token_client: TokenClient<'a>,
    admin: Address,
    user: Address,
    merchant: Address,
}

fn fixture() -> Fixture<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let token_client = TokenClient::new(&env, &token);
    StellarAssetClient::new(&env, &token).mint(&user, &1_000_000);
    StellarAssetClient::new(&env, &token).mint(&admin, &1_000_000);

    let contract_id = env.register(OrbitContract, ());
    let orbit = OrbitContractClient::new(&env, &contract_id);

    Fixture {
        env,
        orbit,
        token,
        token_client,
        admin,
        user,
        merchant,
    }
}

fn splits(env: &Env, token: &Address, sender: &Address, amounts: &[i128]) -> Vec<PaymentSplit> {
    let mut result = Vec::new(env);
    for amount in amounts {
        result.push_back(PaymentSplit {
            recipient: Address::generate(env),
            amount: *amount,
            token: token.clone(),
        });
    }
    // The sender is unused here; callers approve against `sender` separately.
    let _ = sender;
    result
}

// ---------------------------------------------------------------------------
// #223: EMERGENCY PAUSE
// ---------------------------------------------------------------------------

#[test]
fn test_pause_blocks_pull_and_batch_disburse_then_unpause_restores() {
    let f = fixture();
    let interval = 1_000u64;
    f.token_client
        .approve(&f.user, &f.orbit.address, &100_000, &2_000_000);
    f.orbit
        .create_vault(&f.user, &f.merchant, &f.token, &1_000, &interval);
    f.env.ledger().set_timestamp(10);

    f.orbit.set_admin(&f.admin);
    f.orbit.pause(&f.admin);
    assert!(f.orbit.is_paused());
    assert!(f.orbit.get_pause_state().paused);

    assert!(f.orbit.try_pull_funds(&f.user, &f.merchant).is_err());

    let payroll = splits(&f.env, &f.token, &f.user, &[100, 200]);
    assert!(f
        .orbit
        .try_batch_disburse(&f.user, &f.token, &payroll)
        .is_err());
    assert_eq!(f.token_client.balance(&f.user), 1_000_000);

    f.orbit.unpause(&f.admin);
    assert!(!f.orbit.is_paused());
    f.orbit.pull_funds(&f.user, &f.merchant);
    assert_eq!(f.token_client.balance(&f.merchant), 1_000);
    f.orbit.batch_disburse(&f.user, &f.token, &payroll);
    assert_eq!(f.token_client.balance(&f.user), 1_000_000 - 1_000 - 300);
}

#[test]
fn test_pause_and_unpause_require_admin() {
    let f = fixture();
    let outsider = Address::generate(&f.env);
    f.orbit.set_admin(&f.admin);

    assert!(f.orbit.try_pause(&outsider).is_err());
    f.orbit.pause(&f.admin);
    assert!(f.orbit.try_unpause(&outsider).is_err());
    f.orbit.unpause(&f.admin);
    assert!(!f.orbit.is_paused());
}

#[test]
fn test_post_timelock_reclaim_refunds_escrow_and_cancels_vault() {
    let f = fixture();
    let arbiter = Address::generate(&f.env);
    f.token_client
        .approve(&f.user, &f.orbit.address, &100_000, &2_000_000);
    f.orbit
        .create_vault(&f.user, &f.merchant, &f.token, &1_000, &100);
    f.orbit
        .configure_escrow(&f.user, &f.merchant, &arbiter, &30, &518_400);

    f.env.ledger().set_timestamp(10);
    f.orbit.pull_funds(&f.user, &f.merchant);
    assert_eq!(f.token_client.balance(&f.orbit.address), 1_000);
    assert_eq!(f.orbit.get_escrow(&0).unwrap().release_at, 40);

    f.orbit.pause(&f.admin);
    let outsider = Address::generate(&f.env);
    assert!(f
        .orbit
        .try_reclaim_paused_vault(&outsider, &f.merchant)
        .is_err());
    assert!(f
        .orbit
        .try_reclaim_paused_vault(&f.user, &f.merchant)
        .is_err());

    f.env
        .ledger()
        .set_timestamp(10 + PAUSE_RECOVERY_TIMELOCK_SECONDS + 1);
    f.orbit.reclaim_paused_vault(&f.user, &f.merchant);

    assert!(f.orbit.get_vault(&f.user, &f.merchant).is_none());
    assert!(f.orbit.get_escrow(&0).is_none());
    assert_eq!(f.token_client.balance(&f.user), 1_000_000);
    assert_eq!(f.token_client.balance(&f.orbit.address), 0);
}

// ---------------------------------------------------------------------------
// #224: PROTOCOL TREASURY FEE
// ---------------------------------------------------------------------------

#[test]
fn test_batch_disburse_without_fee_pays_full_amounts() {
    let f = fixture();
    let payroll = splits(&f.env, &f.token, &f.user, &[100, 200, 300]);
    f.token_client
        .approve(&f.user, &f.orbit.address, &600, &2_000_000);

    f.orbit.batch_disburse(&f.user, &f.token, &payroll);

    for (expected, split) in [100i128, 200, 300].iter().zip(payroll.iter()) {
        assert_eq!(f.token_client.balance(&split.recipient), *expected);
    }
}

#[test]
fn test_batch_disburse_deducts_fractional_fee_and_emits_event() {
    let f = fixture();
    let treasury = Address::generate(&f.env);
    f.orbit.set_protocol_fee(&f.admin, &333, &treasury);
    assert_eq!(f.orbit.get_protocol_fee().unwrap().fee_bps, 333);

    // 333 bps of 100 = 3.33 -> 3 (round down), of 200 = 6.66 -> 6.
    let payroll = splits(&f.env, &f.token, &f.user, &[100, 200]);
    f.token_client
        .approve(&f.user, &f.orbit.address, &300, &2_000_000);
    f.orbit.batch_disburse(&f.user, &f.token, &payroll);

    // The transparency event carries (treasury, fee_amount) and is emitted in
    // the same atomic transaction as the payouts.
    let expected_events = soroban_sdk::vec![
        &f.env,
        (
            f.orbit.address.clone(),
            soroban_sdk::vec![&f.env, symbol_short!("fee").to_val(), treasury.to_val()],
            9i128.into_val(&f.env),
        ),
        (
            f.orbit.address.clone(),
            soroban_sdk::vec![
                &f.env,
                Symbol::new(&f.env, "batch_disbursed").to_val(),
                f.user.to_val()
            ],
            (f.token.clone(), 2u32, 291i128).into_val(&f.env),
        ),
        (
            f.orbit.address.clone(),
            soroban_sdk::vec![
                &f.env,
                Symbol::new(&f.env, "payroll_summary").to_val(),
                f.user.to_val()
            ],
            (
                soroban_sdk::vec![&f.env, f.token.clone()],
                soroban_sdk::vec![&f.env, 291i128],
                2u32,
                f.env.ledger().sequence(),
            )
                .into_val(&f.env),
        ),
    ];
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.orbit.address),
        expected_events
    );

    assert_eq!(
        f.token_client.balance(&payroll.get(0).unwrap().recipient),
        97
    );
    assert_eq!(
        f.token_client.balance(&payroll.get(1).unwrap().recipient),
        194
    );
    assert_eq!(f.token_client.balance(&treasury), 9);
}

#[test]
fn test_batch_disburse_max_fee_and_invalid_cap() {
    let f = fixture();
    let treasury = Address::generate(&f.env);
    assert!(f
        .orbit
        .try_set_protocol_fee(&f.admin, &1_001, &treasury)
        .is_err());

    f.orbit.set_protocol_fee(&f.admin, &1_000, &treasury);
    let payroll = splits(&f.env, &f.token, &f.user, &[100]);
    f.token_client
        .approve(&f.user, &f.orbit.address, &100, &2_000_000);
    f.orbit.batch_disburse(&f.user, &f.token, &payroll);
    assert_eq!(
        f.token_client.balance(&payroll.get(0).unwrap().recipient),
        90
    );
    assert_eq!(f.token_client.balance(&treasury), 10);

    // Zero bps disables the hook entirely.
    f.orbit.set_protocol_fee(&f.admin, &0, &treasury);
    let payroll2 = splits(&f.env, &f.token, &f.user, &[100]);
    f.token_client
        .approve(&f.user, &f.orbit.address, &100, &2_000_000);
    f.orbit.batch_disburse(&f.user, &f.token, &payroll2);
    assert_eq!(
        f.token_client.balance(&payroll2.get(0).unwrap().recipient),
        100
    );
    assert_eq!(f.token_client.balance(&treasury), 10);
}

// ---------------------------------------------------------------------------
// #225: MILESTONE ESCROW
// ---------------------------------------------------------------------------

#[test]
fn test_milestone_escrow_approval_progression() {
    let f = fixture();
    let contractor = Address::generate(&f.env);
    let arbiter = Address::generate(&f.env);
    let amounts = soroban_sdk::vec![&f.env, 300i128, 700i128];

    let id =
        f.orbit
            .create_milestone_escrow(&f.user, &contractor, &arbiter, &f.token, &1_000, &amounts);
    assert_eq!(f.token_client.balance(&f.orbit.address), 1_000);
    assert_eq!(
        f.orbit.get_milestone_escrow(&id).unwrap().status,
        MilestoneEscrowStatus::Pending
    );

    f.orbit.approve_milestone(&f.user, &id, &0);
    assert_eq!(f.token_client.balance(&contractor), 300);
    // Double approval is rejected.
    assert!(f.orbit.try_approve_milestone(&f.user, &id, &0).is_err());

    f.orbit.approve_milestone(&f.user, &id, &1);
    assert_eq!(f.token_client.balance(&contractor), 1_000);
    let escrow = f.orbit.get_milestone_escrow(&id).unwrap();
    assert_eq!(escrow.status, MilestoneEscrowStatus::Approved);
    assert_eq!(escrow.released_amount, 1_000);
    assert!(escrow.released.get(0).unwrap());
    assert!(escrow.released.get(1).unwrap());
}

#[test]
fn test_milestone_escrow_rejects_bad_config_and_unauthorized_party() {
    let f = fixture();
    let contractor = Address::generate(&f.env);
    let arbiter = Address::generate(&f.env);
    let outsider = Address::generate(&f.env);

    // Milestone amounts must not exceed the deposited balance.
    assert!(f
        .orbit
        .try_create_milestone_escrow(
            &f.user,
            &contractor,
            &arbiter,
            &f.token,
            &100,
            &soroban_sdk::vec![&f.env, 60i128, 60i128],
        )
        .is_err());

    let id = f.orbit.create_milestone_escrow(
        &f.user,
        &contractor,
        &arbiter,
        &f.token,
        &1_000,
        &soroban_sdk::vec![&f.env, 1_000i128],
    );
    assert!(f.orbit.try_approve_milestone(&outsider, &id, &0).is_err());
    assert!(f.orbit.try_approve_milestone(&f.user, &id, &1).is_err());
    assert_eq!(f.token_client.balance(&contractor), 0);
}

#[test]
fn test_milestone_dispute_is_arbiter_only_and_splits_remaining_balance() {
    let f = fixture();
    let contractor = Address::generate(&f.env);
    let arbiter = Address::generate(&f.env);
    let outsider = Address::generate(&f.env);

    let id = f.orbit.create_milestone_escrow(
        &f.user,
        &contractor,
        &arbiter,
        &f.token,
        &1_000,
        &soroban_sdk::vec![&f.env, 400i128, 600i128],
    );
    f.orbit.approve_milestone(&f.user, &id, &0);
    assert_eq!(f.token_client.balance(&contractor), 400);

    f.orbit.dispute_milestone_escrow(&contractor, &id);
    assert_eq!(
        f.orbit.get_milestone_escrow(&id).unwrap().status,
        MilestoneEscrowStatus::Disputed
    );
    assert!(f
        .orbit
        .try_resolve_dispute(&outsider, &id, &250, &350)
        .is_err());
    assert!(f
        .orbit
        .try_resolve_dispute(&arbiter, &id, &250, &300)
        .is_err());

    f.orbit.resolve_dispute(&arbiter, &id, &250, &350);
    // 1,000,000 - 1,000 deposited + 250 arbiter refund.
    assert_eq!(f.token_client.balance(&f.user), 999_250);
    assert_eq!(f.token_client.balance(&contractor), 750);
    assert_eq!(f.token_client.balance(&f.orbit.address), 0);
    let escrow = f.orbit.get_milestone_escrow(&id).unwrap();
    assert_eq!(escrow.status, MilestoneEscrowStatus::Refunded);
    assert_eq!(escrow.released_amount, 1_000);
}

#[test]
fn test_milestone_dispute_bond_frivolous_penalty_forfeits_to_counterparty() {
    let f = fixture();
    let contractor = Address::generate(&f.env);
    let arbiter = Address::generate(&f.env);

    let id = f.orbit.create_milestone_escrow(
        &f.user,
        &contractor,
        &arbiter,
        &f.token,
        &1_000,
        &soroban_sdk::vec![&f.env, 400i128, 600i128],
    );
    f.orbit.approve_milestone(&f.user, &id, &0);
    assert_eq!(f.token_client.balance(&contractor), 400);

    // Contractor initiates dispute: 5% bond on 600 remaining = 30 bond
    f.orbit.dispute_milestone_escrow(&contractor, &id);
    assert_eq!(f.token_client.balance(&contractor), 370);
    assert_eq!(f.token_client.balance(&f.orbit.address), 630);

    let bond_record = f.orbit.get_milestone_dispute_bond(&id).unwrap();
    assert_eq!(bond_record.claimant, contractor);
    assert_eq!(bond_record.amount, 30);

    // Arbiter resolves dispute with frivolous = true (employer gets 500, contractor 100).
    // Frivolous penalty: bond (30) is forfeited to employer (counterparty).
    f.orbit.resolve_dispute_with_ruling(&arbiter, &id, &500, &100, &true);

    // Employer gets: initial 999_000 + 500 split + 30 forfeited bond = 999_530
    assert_eq!(f.token_client.balance(&f.user), 999_530);
    // Contractor gets: 370 + 100 split (bond forfeited) = 470
    assert_eq!(f.token_client.balance(&contractor), 470);
    assert_eq!(f.token_client.balance(&f.orbit.address), 0);
    assert!(f.orbit.get_milestone_dispute_bond(&id).is_none());
}

#[test]
fn test_milestone_dispute_rejects_when_bond_balance_is_insufficient() {
    let f = fixture();
    let contractor = Address::generate(&f.env);
    let arbiter = Address::generate(&f.env);

    let id = f.orbit.create_milestone_escrow(
        &f.user,
        &contractor,
        &arbiter,
        &f.token,
        &1_000,
        &soroban_sdk::vec![&f.env, 400i128, 600i128],
    );
    // Neither milestone approved yet, contractor has 0 tokens
    assert_eq!(f.token_client.balance(&contractor), 0);
    // Attempting dispute requires 5% of 1000 = 50 tokens, so it fails due to lack of balance
    assert!(f.orbit.try_dispute_milestone_escrow(&contractor, &id).is_err());
}

// ---------------------------------------------------------------------------
// #226: SLIDING-WINDOW RATE LIMITS
// ---------------------------------------------------------------------------

fn rate_limit_vault(f: &Fixture<'_>, amount: i128) {
    f.token_client
        .approve(&f.user, &f.orbit.address, &100_000, &2_000_000);
    // A one-second interval allows rapid, consecutive billing cycles.
    f.orbit
        .create_vault(&f.user, &f.merchant, &f.token, &amount, &1);
}

#[test]
fn test_rate_limit_rejects_pulls_over_cumulative_ceiling() {
    let f = fixture();
    rate_limit_vault(&f, 60);
    f.orbit
        .configure_vault_rate_limit(&f.user, &f.merchant, &100, &150);
    let limit = f.orbit.get_vault_rate_limit(&f.user, &f.merchant).unwrap();
    assert_eq!(limit.max_cumulative_amount, 150);

    f.env.ledger().set_timestamp(1);
    f.orbit.pull_funds(&f.user, &f.merchant);
    assert_eq!(f.token_client.balance(&f.merchant), 60);

    f.env.ledger().set_timestamp(2);
    f.orbit.pull_funds(&f.user, &f.merchant);
    assert_eq!(f.token_client.balance(&f.merchant), 120);
    assert_eq!(
        f.orbit
            .get_vault_rate_limit(&f.user, &f.merchant)
            .unwrap()
            .window_spent,
        120
    );

    // 120 + 60 = 180 > 150, so the third pull is refused atomically.
    f.env.ledger().set_timestamp(3);
    assert!(f.orbit.try_pull_funds(&f.user, &f.merchant).is_err());
    assert_eq!(f.token_client.balance(&f.merchant), 120);
    assert_eq!(
        f.orbit
            .get_vault_rate_limit(&f.user, &f.merchant)
            .unwrap()
            .window_spent,
        120
    );
}

#[test]
fn test_rate_limit_window_expiry_resets_capacity() {
    let f = fixture();
    rate_limit_vault(&f, 60);
    // Two-ledger window: capacity fully decays as soon as it elapses.
    f.orbit
        .configure_vault_rate_limit(&f.user, &f.merchant, &2, &60);

    f.env.ledger().set_timestamp(1);
    f.orbit.pull_funds(&f.user, &f.merchant);
    assert_eq!(f.token_client.balance(&f.merchant), 60);
    assert!(f.orbit.try_pull_funds(&f.user, &f.merchant).is_err());

    f.env.ledger().set_sequence_number(2);
    f.env.ledger().set_timestamp(2);
    f.orbit.pull_funds(&f.user, &f.merchant);
    assert_eq!(f.token_client.balance(&f.merchant), 120);
    let limit = f.orbit.get_vault_rate_limit(&f.user, &f.merchant).unwrap();
    assert_eq!(limit.window_start_ledger, 2);
    assert_eq!(limit.window_spent, 60);
}

#[test]
fn test_rate_limit_rejects_invalid_configuration() {
    let f = fixture();
    rate_limit_vault(&f, 10);
    assert!(f
        .orbit
        .try_configure_vault_rate_limit(&f.user, &f.merchant, &0, &100)
        .is_err());
    assert!(f
        .orbit
        .try_configure_vault_rate_limit(&f.user, &f.merchant, &10, &0)
        .is_err());
    assert!(f.orbit.get_vault_rate_limit(&f.user, &f.merchant).is_none());
}
