#![cfg(test)]

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    xdr::{AccountId, PublicKey, ScAddress, Uint256},
    TryFromVal,
};

fn signer(env: &Env, seed: u8) -> (SigningKey, Address) {
    let key = SigningKey::from_bytes(&[seed; 32]);
    let user = Address::try_from_val(
        env,
        &ScAddress::Account(AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(
            key.verifying_key().to_bytes(),
        )))),
    )
    .unwrap();
    (key, user)
}

fn signed(
    env: &Env,
    contract: &Address,
    key: &SigningKey,
    user: &Address,
    merchant: &Address,
    token: &Address,
    nonce: u64,
) -> DelegatedVaultAuth {
    let mut auth = DelegatedVaultAuth {
        user: user.clone(),
        merchant: merchant.clone(),
        token: token.clone(),
        amount: 12_000_000,
        interval_ledgers: 17_280,
        nonce,
        expiry_ledger: env.ledger().sequence().saturating_add(100),
        signature: BytesN::from_array(env, &[0; 64]),
    };
    let digest = env.as_contract(contract, || delegated_batch_vault_digest(env, &auth));
    auth.signature = BytesN::from_array(env, &key.sign(&digest.to_array()).to_bytes());
    auth
}

#[test]
fn batch_onboards_multiple_subscribers_without_wallet_auth() {
    let env = Env::default();
    let (key1, user1) = signer(&env, 21);
    let (key2, user2) = signer(&env, 22);
    let merchant = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let contract = env.register(OrbitContract, ());
    let client = OrbitContractClient::new(&env, &contract);
    let a = signed(&env, &contract, &key1, &user1, &merchant, &token, 0);
    let b = signed(&env, &contract, &key2, &user2, &merchant, &token, 0);
    let batch = soroban_sdk::vec![&env, a.clone(), b.clone()];
    assert_eq!(client.batch_create_vaults_delegated(&batch), 2);
    assert_eq!(client.get_user_nonce(&user1), 1);
    assert_eq!(client.get_user_nonce(&user2), 1);
    assert_eq!(
        client
            .get_vault(&user1, &merchant)
            .unwrap()
            .amount_per_interval,
        a.amount
    );
    assert_eq!(
        client.get_vault(&user2, &merchant).unwrap().interval_seconds,
        86_400
    );
    assert!(env.auths().is_empty());

    // Both authorizations are now consumed and cannot be replayed.
    assert_eq!(
        client.try_batch_create_vaults_delegated(&batch),
        Err(Ok(DelegatedAuthError::InvalidNonce))
    );
}

#[test]
fn mixed_forgery_aborts_entire_batch_and_preserves_nonces() {
    let env = Env::default();
    let (key1, user1) = signer(&env, 24);
    let (key2, user2) = signer(&env, 25);
    let (attacker, _) = signer(&env, 26);
    let merchant = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let contract = env.register(OrbitContract, ());
    let client = OrbitContractClient::new(&env, &contract);
    let valid = signed(&env, &contract, &key1, &user1, &merchant, &token, 0);
    let forged = signed(&env, &contract, &attacker, &user2, &merchant, &token, 0);
    let batch = soroban_sdk::vec![&env, valid.clone(), forged];
    assert!(client.try_batch_create_vaults_delegated(&batch).is_err());
    assert!(client.get_vault(&user1, &merchant).is_none());
    assert!(client.get_vault(&user2, &merchant).is_none());
    assert_eq!(client.get_user_nonce(&user1), 0);
    assert_eq!(client.get_user_nonce(&user2), 0);

    let second = signed(&env, &contract, &key2, &user2, &merchant, &token, 0);
    assert_eq!(
        client.batch_create_vaults_delegated(&soroban_sdk::vec![&env, valid, second]),
        2
    );
}

#[test]
fn batch_rejects_stale_nonce_and_duplicate_authorization_atomically() {
    let env = Env::default();
    let (key, user) = signer(&env, 27);
    let merchant = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let contract = env.register(OrbitContract, ());
    let client = OrbitContractClient::new(&env, &contract);
    let a = signed(&env, &contract, &key, &user, &merchant, &token, 0);
    let duplicate = soroban_sdk::vec![&env, a.clone(), a.clone()];
    assert_eq!(
        client.try_batch_create_vaults_delegated(&duplicate),
        Err(Ok(DelegatedAuthError::InvalidNonce))
    );
    assert!(client.get_vault(&user, &merchant).is_none());
    assert_eq!(client.get_user_nonce(&user), 0);
    let bad = signed(&env, &contract, &key, &user, &merchant, &token, 9);
    assert_eq!(
        client.try_batch_create_vaults_delegated(&soroban_sdk::vec![&env, a, bad]),
        Err(Ok(DelegatedAuthError::InvalidNonce))
    );
    assert_eq!(client.get_user_nonce(&user), 0);
}

#[test]
fn batch_rejects_expired_empty_and_tampered_entries() {
    let env = Env::default();
    let (key, user) = signer(&env, 28);
    let merchant = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let contract = env.register(OrbitContract, ());
    let client = OrbitContractClient::new(&env, &contract);
    assert_eq!(
        client.try_batch_create_vaults_delegated(&Vec::new(&env)),
        Err(Ok(DelegatedAuthError::InvalidAuthorization))
    );
    let valid = signed(&env, &contract, &key, &user, &merchant, &token, 0);
    let mut tampered = valid.clone();
    tampered.amount += 1;
    assert!(
        client
            .try_batch_create_vaults_delegated(&soroban_sdk::vec![&env, tampered])
            .is_err()
    );
    let mut expired = valid.clone();
    expired.expiry_ledger = 0;
    env.ledger().set_sequence_number(2);
    assert_eq!(
        client.try_batch_create_vaults_delegated(&soroban_sdk::vec![&env, expired]),
        Err(Ok(DelegatedAuthError::SignatureExpired))
    );
    assert_eq!(client.get_user_nonce(&user), 0);
}
