// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {OrbitPuller} from "../src/OrbitPuller.sol";

/// @notice Deploys OrbitPuller to Arc.
///
/// One-time key setup (encrypted keystore — no plaintext key on disk):
///   cast wallet import orbit-deployer --interactive
///
/// Dry run:
///   forge script script/Deploy.s.sol:Deploy --rpc-url $ARC_RPC_URL
///
/// Broadcast:
///   forge script script/Deploy.s.sol:Deploy --rpc-url $ARC_RPC_URL \
///     --account orbit-deployer --broadcast --verify
///
/// @dev `startBroadcast()` takes no argument on purpose: the signer comes from the
///      CLI (`--account`, `--private-key`, or `--ledger`), so no key is ever read
///      from a file this repo can accidentally commit.
///
///      On Arc, gas is paid in USDC — fund the deployer from the Arc testnet faucet,
///      not from a separate gas token. See Build_Guide Task 6.0 / 6.4.
contract Deploy is Script {
    function run() external returns (OrbitPuller puller) {
        // Two supported signing paths:
        //   1. DEPLOYER_PRIVATE_KEY in .env  — forge auto-loads it, no prompt.
        //   2. Nothing in .env               — signer comes from the CLI
        //                                      (--account / --private-key / --ledger).
        uint256 pk = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));

        if (pk != 0) {
            vm.startBroadcast(pk);
        } else {
            vm.startBroadcast();
        }

        puller = new OrbitPuller();
        vm.stopBroadcast();

        console.log("OrbitPuller deployed at:", address(puller));
        console.log("Record this in apps/backend/.env, Docs/ARCHITECTURE.md, and README.md section 4.");
    }
}
