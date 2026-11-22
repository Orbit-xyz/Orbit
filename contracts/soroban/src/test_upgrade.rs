extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, BytesN, Env, IntoVal,
};

// ----------------------------------------------------------------------------
// ADMIN-GUARDED UPGRADE ENTRYPOINT (#354)
// ----------------------------------------------------------------------------

#[test]
fn test_upgrade_rejects_a_non_admin_caller() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OrbitContract, ());
    let orbit = OrbitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    orbit.set_admin(&admin);

    let attacker = Address::generate(&env);
    let hash = BytesN::from_array(&env, &[7u8; 32]);
    let res = orbit
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "upgrade",
                args: (&attacker, &hash).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_upgrade(&attacker, &hash);
    assert!(res.is_err());
}

#[test]
fn test_upgrade_requires_bytecode_to_be_installed_first() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OrbitContract, ());
    let orbit = OrbitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    orbit.set_admin(&admin);

    // The admin is authorized, but no WASM with this hash was uploaded, so the
    // host rejects the swap and the contract keeps its current code.
    let hash = BytesN::from_array(&env, &[9u8; 32]);
    assert!(orbit.try_upgrade(&admin, &hash).is_err());
}
