#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, Address, token};
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::token::StellarAssetClient;

#[test]
fn test_allowance_handshake_and_pull() {
    let env = Env::default();
    
    // In unit tests, we mock the wallet signatures (mock_all_auths) 
    // so we can test the logic without a real frontend connecting.
    env.mock_all_auths();

    // Generate dummy addresses for our actors
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let token_admin = Address::generate(&env);

    // Deploy a mock testnet token (represents our USDC with 7 decimals)
    let token_address = env.register_stellar_asset_contract(token_admin.clone());
    let token_client = TokenClient::new(&env, &token_address);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    // Mint 100 USDC to the user to start
    token_admin_client.mint(&user, &100_0000000);

    // Register our Orbit Contract
    let contract_id = env.register_contract(None, OrbitContract);
    let orbit_client = OrbitContractClient::new(&env, &contract_id);

    // ------------------------------------------------------------------------
    // SCENARIO 1: THE HANDSHAKE
    // ------------------------------------------------------------------------
    let amount = 29_0000000; // 29 USDC (with 7 zeroes for precision)
    let interval = 30 * 24 * 60 * 60; // 30 days in seconds

    // User approves the contract to spend the recurring charge
    token_client.approve(&user, &orbit_client.address, &amount, &2000000);

    // User creates the vault (approving the 29 USDC recurring charge)
    orbit_client.create_vault(&user, &merchant, &token_address, &amount, &interval);

    // ------------------------------------------------------------------------
    // SCENARIO 2: THE PULL
    // ------------------------------------------------------------------------
    // Merchant executes the billing
    orbit_client.pull_funds(&user, &merchant);

    // Verify the math! The merchant should have exactly 29 USDC.
    assert_eq!(token_client.balance(&merchant), 29_0000000);
    // The user should have 100 - 29 = 71 USDC remaining.
    assert_eq!(token_client.balance(&user), 71_0000000);
}
