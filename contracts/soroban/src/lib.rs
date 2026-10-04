#![no_std]
#![allow(deprecated)]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Symbol, Vec};

// ----------------------------------------------------------------------------
// DATA STRUCTURES
// ----------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultKey {
    pub user: Address,
    pub merchant: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultData {
    pub token: Address,
    pub amount_per_interval: i128,
    pub interval_seconds: u64,
    pub last_pull_timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentSplit {
    pub recipient: Address,
    pub amount: i128,
}

// ----------------------------------------------------------------------------
// CONTRACT LOGIC
// ----------------------------------------------------------------------------

#[contract]
pub struct OrbitContract;

#[contractimpl]
impl OrbitContract {
    /// 1. THE HANDSHAKE (Create Allowance)
    /// The user calls this to set up a recurring subscription for a merchant.
    pub fn create_vault(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
        amount_per_interval: i128,
        interval_seconds: u64,
    ) {
        user.require_auth();

        assert!(
            amount_per_interval > 0,
            "amount_per_interval must be positive"
        );
        assert!(
            interval_seconds > 0,
            "interval_seconds must be greater than zero"
        );

        let key = VaultKey {
            user: user.clone(),
            merchant: merchant.clone(),
        };

        let vault_data = VaultData {
            token: token.clone(),
            amount_per_interval,
            interval_seconds,
            last_pull_timestamp: 0,
        };

        env.storage().persistent().set(&key, &vault_data);

        // Emit contract event
        env.events().publish(
            (Symbol::new(&env, "vault_created"), user, merchant),
            (token, amount_per_interval, interval_seconds),
        );
    }

    /// Read the current terms for a user/merchant vault.
    /// This entrypoint requires no authorization and does not modify storage.
    pub fn get_vault(env: Env, user: Address, merchant: Address) -> Option<VaultData> {
        let key = VaultKey { user, merchant };

        env.storage().persistent().get(&key)
    }

    /// 2. THE PULL (Execute Billing)
    /// The merchant (or the Orbit backend) calls this to pull the funds.
    pub fn pull_funds(env: Env, user: Address, merchant: Address) {
        merchant.require_auth();

        let key = VaultKey {
            user: user.clone(),
            merchant: merchant.clone(),
        };
        let mut vault: VaultData = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Vault does not exist");
        let current_time = env.ledger().timestamp();

        if vault.last_pull_timestamp != 0 {
            assert!(
                current_time >= vault.last_pull_timestamp + vault.interval_seconds,
                "Too early to pull funds"
            );
        }

        let token_client = token::Client::new(&env, &vault.token);
        token_client.transfer_from(
            &env.current_contract_address(),
            &user,
            &merchant,
            &vault.amount_per_interval,
        );

        vault.last_pull_timestamp = current_time;
        env.storage().persistent().set(&key, &vault);

        // Emit contract event
        env.events().publish(
            (Symbol::new(&env, "funds_pulled"), user, merchant),
            (vault.amount_per_interval, current_time),
        );
    }

    /// 3. THE SPLIT (Batch Payroll Disbursement)
    /// The merchant uploads a CSV of contractors. This function takes that array
    /// and routes the stablecoins to everyone globally in a single transaction block.
    pub fn batch_disburse(env: Env, sender: Address, token: Address, splits: Vec<PaymentSplit>) {
        // The sender (e.g., the Agency Owner) MUST sign this transaction to approve the payroll.
        sender.require_auth();

        let token_client = token::Client::new(&env, &token);
        let recipient_count = splits.len();
        let mut total_amount: i128 = 0;

        // Loop through the array of contractors and amounts
        for split in splits.into_iter() {
            total_amount = total_amount
                .checked_add(split.amount)
                .expect("Total amount overflow");

            // Transfer the exact cut directly from the sender's wallet to the contractor
            token_client.transfer_from(
                &env.current_contract_address(),
                &sender,
                &split.recipient,
                &split.amount,
            );
        }

        // Emit contract event
        env.events().publish(
            (Symbol::new(&env, "batch_disbursed"), sender),
            (token, recipient_count, total_amount),
        );
    }
}

#[cfg(test)]
mod test;
