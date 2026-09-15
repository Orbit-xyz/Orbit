#!/bin/bash

# Exit on any error
set -e

echo "Starting Deployment to Stellar Testnet..."

# 1. Compile the Rust contract to WebAssembly
echo "Compiling contract to WebAssembly..."
cd ../contracts/soroban
stellar contract build

# Ensure the target dir exists (for optimized wasm, though build usually puts it in target/wasm32v1-none/release)
WASM_PATH="target/wasm32v1-none/release/orbit_contract.wasm"

# Optional: Optimize the WASM if you have stellar-cli installed with optimization features
# stellar contract optimize --wasm $WASM_PATH

echo "Compiled successfully: $WASM_PATH"

# 2. Setup the testnet identity (if not already set up)
echo "Checking for testnet identity..."
# We create an identity named 'alice' on the testnet. 
# If it already exists, this command will error, so we catch it.
stellar keys generate alice --network testnet || echo "Identity 'alice' already exists."

# 3. Deploy to Testnet
echo "Deploying contract to Stellar Testnet..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm $WASM_PATH \
  --source alice \
  --network testnet)

echo "Deployment successful."
echo "Contract ID: $CONTRACT_ID"

# Save the Contract ID to a file so other scripts can use it
echo $CONTRACT_ID > ../../scripts/.contract_id
echo "Contract ID saved to scripts/.contract_id"
