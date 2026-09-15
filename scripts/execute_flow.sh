#!/bin/bash

# Exit on any error
set -e

echo "Starting E2E Test Flow on Stellar Testnet..."

# Read the contract ID from the previous deployment
ORBIT_CONTRACT=$(cat .contract_id)
echo "Orbit Contract ID: $ORBIT_CONTRACT"

# 1. GENERATE WALLETS
echo "Generating Customer (bob) and Contractor (charlie) wallets..."
stellar keys generate bob --network testnet --fund || echo "Bob already exists"
stellar keys generate charlie --network testnet --fund || echo "Charlie already exists"

BOB_ADDRESS=$(stellar keys address bob)
ALICE_ADDRESS=$(stellar keys address alice)
CHARLIE_ADDRESS=$(stellar keys address charlie)

# 2. GET DUMMY USDC (Native XLM)
echo "Getting Dummy USDC (Wrapped XLM) Contract ID..."
# For testing, we use the testnet's built-in wrapped XLM token
USDC_CONTRACT=$(stellar contract id asset --asset native --network testnet)
echo "Dummy Token Contract ID: $USDC_CONTRACT"

# 3. APPROVE ALLOWANCE (THE HANDSHAKE)
echo "Customer (Bob) approving Orbit Contract to spend his tokens..."
# The standard token interface has an `approve` function. 
# from, spender, amount, live_until_ledger
stellar contract invoke \
  --id $USDC_CONTRACT \
  --source bob \
  --network testnet \
  -- \
  approve \
  --from $BOB_ADDRESS \
  --spender $ORBIT_CONTRACT \
  --amount 500000000 \
  --live_until_ledger 5000000

# 4. CREATE VAULT
echo "Customer (Bob) creating the vault..."
# user, merchant, token, amount_per_interval, interval_seconds
stellar contract invoke \
  --id $ORBIT_CONTRACT \
  --source bob \
  --network testnet \
  -- \
  create_vault \
  --user $BOB_ADDRESS \
  --merchant $ALICE_ADDRESS \
  --token $USDC_CONTRACT \
  --amount_per_interval 290000000 \
  --interval_seconds 2592000

# 5. PULL FUNDS
echo "Merchant (Alice) pulling funds from Bob..."
stellar contract invoke \
  --id $ORBIT_CONTRACT \
  --source alice \
  --network testnet \
  -- \
  pull_funds \
  --user $BOB_ADDRESS \
  --merchant $ALICE_ADDRESS

# 6. BATCH DISBURSE
echo "Merchant (Alice) running batch payroll..."
# Alice approves the contract to spend her tokens first (so it can distribute them to Charlie)
stellar contract invoke \
  --id $USDC_CONTRACT \
  --source alice \
  --network testnet \
  -- \
  approve \
  --from $ALICE_ADDRESS \
  --spender $ORBIT_CONTRACT \
  --amount 100000000 \
  --live_until_ledger 5000000

# Now Alice calls batch_disburse. We pass a JSON array for the splits.
# splits: [{"recipient": "charlie_address", "amount": "100000000"}]
stellar contract invoke \
  --id $ORBIT_CONTRACT \
  --source alice \
  --network testnet \
  -- \
  batch_disburse \
  --sender $ALICE_ADDRESS \
  --token $USDC_CONTRACT \
  --splits "[{\"recipient\": \"$CHARLIE_ADDRESS\", \"amount\": \"100000000\"}]"

echo "End-to-End Test Flow Completed Successfully!"
