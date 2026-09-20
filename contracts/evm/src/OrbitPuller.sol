// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OrbitPuller
/// @notice Non-custodial pull payments and atomic batch payroll, denominated in USDC.
/// @dev EVM port of the Soroban `OrbitContract` (contracts/soroban/src/lib.rs). The Arc
///      rail runs alongside the Stellar rail; neither replaces the other.
///
///      This contract NEVER holds funds. It only moves tokens the payer has explicitly
///      approved to it, and only within the cadence and cap recorded in their vault.
///      Revoking the ERC-20 allowance or calling `revokeVault` stops all future pulls.
contract OrbitPuller is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------
    // DATA STRUCTURES  (mirrors Soroban VaultData)
    // ------------------------------------------------------------------

    struct Vault {
        address token;
        uint256 amountPerInterval;
        uint64 intervalSeconds;
        uint64 lastPullTimestamp;
        bool active;
    }

    /// @dev Mirrors the Soroban `VaultKey { user, merchant }` persistent-storage tuple.
    mapping(address user => mapping(address merchant => Vault)) private _vaults;

    // ------------------------------------------------------------------
    // EVENTS
    // ------------------------------------------------------------------
    // New vs. Soroban: EVM has no ledger-event equivalent to read back, so the
    // dashboard activity feed and the ARCHITECTURE.md webhooks index these.

    event VaultCreated(
        address indexed user,
        address indexed merchant,
        address indexed token,
        uint256 amountPerInterval,
        uint64 intervalSeconds
    );
    event VaultRevoked(address indexed user, address indexed merchant);
    event FundsPulled(address indexed user, address indexed merchant, address indexed token, uint256 amount);
    event BatchDisbursed(address indexed sender, address indexed token, uint256 total, uint256 recipientCount);

    // ------------------------------------------------------------------
    // ERRORS
    // ------------------------------------------------------------------
    // Custom errors instead of Soroban's assert! strings: cheaper, and the
    // dashboard can decode them into the error table in the docs portal.

    error InvalidParams();
    error VaultNotFound();
    error TooEarlyToPull();
    error LengthMismatch();

    // ------------------------------------------------------------------
    // 1. THE HANDSHAKE  (Soroban: create_vault)
    // ------------------------------------------------------------------

    /// @notice Subscriber authorizes `merchant` to pull `amountPerInterval` once per interval.
    /// @dev No tokens move here. `msg.sender` is the subscriber, which is EVM's implicit
    ///      equivalent of Soroban's explicit `user.require_auth()`.
    ///
    ///      The subscriber must ALSO call `token.approve(address(this), ...)` — on Soroban
    ///      the SAC allowance is a separate step too, so this is parity, not new friction.
    function createVault(address merchant, address token, uint256 amountPerInterval, uint64 intervalSeconds)
        external
    {
        if (merchant == address(0) || token == address(0)) revert InvalidParams();
        if (amountPerInterval == 0 || intervalSeconds == 0) revert InvalidParams();

        _vaults[msg.sender][merchant] = Vault({
            token: token,
            amountPerInterval: amountPerInterval,
            intervalSeconds: intervalSeconds,
            lastPullTimestamp: 0,
            active: true
        });

        emit VaultCreated(msg.sender, merchant, token, amountPerInterval, intervalSeconds);
    }

    /// @notice Subscriber cancels their authorization.
    /// @dev Not present in the Soroban version, where a user can only revoke by zeroing
    ///      the token allowance. Backs the `subscription.cancelled` webhook in ARCHITECTURE.md §6C.
    function revokeVault(address merchant) external {
        if (!_vaults[msg.sender][merchant].active) revert VaultNotFound();
        delete _vaults[msg.sender][merchant];
        emit VaultRevoked(msg.sender, merchant);
    }

    // ------------------------------------------------------------------
    // 2. THE PULL  (Soroban: pull_funds)
    // ------------------------------------------------------------------

    /// @notice Merchant collects one interval's payment from `user`.
    /// @dev `msg.sender` is the merchant — replaces Soroban's `merchant.require_auth()`,
    ///      which is why this takes one argument where the Rust version takes two.
    ///
    ///      Cadence is checked against `block.timestamp`, never a caller-supplied value,
    ///      matching the Soroban contract's use of `env.ledger().timestamp()`.
    function pullFunds(address user) external nonReentrant {
        Vault storage v = _vaults[user][msg.sender];
        if (!v.active) revert VaultNotFound();

        if (v.lastPullTimestamp != 0) {
            if (block.timestamp < uint256(v.lastPullTimestamp) + uint256(v.intervalSeconds)) {
                revert TooEarlyToPull();
            }
        }

        uint256 amount = v.amountPerInterval;
        address token = v.token;

        // Checks-Effects-Interactions: stamp the pull BEFORE transferring, so a
        // malicious or reentrant token cannot replay a pull inside the same window.
        v.lastPullTimestamp = uint64(block.timestamp);

        IERC20(token).safeTransferFrom(user, msg.sender, amount);

        emit FundsPulled(user, msg.sender, token, amount);
    }

    // ------------------------------------------------------------------
    // 3. THE SPLIT  (Soroban: batch_disburse)
    // ------------------------------------------------------------------

    /// @notice Atomic multi-recipient payout: one signature, N transfers, all-or-nothing.
    /// @dev If any leg fails the whole call reverts, so payroll can never land partially.
    ///      Same guarantee as the Soroban version, which relies on single-invocation atomicity.
    function batchDisburse(address token, address[] calldata recipients, uint256[] calldata amounts)
        external
        nonReentrant
    {
        if (recipients.length != amounts.length) revert LengthMismatch();
        if (recipients.length == 0 || token == address(0)) revert InvalidParams();

        IERC20 erc20 = IERC20(token);
        uint256 total;

        for (uint256 i; i < recipients.length; ++i) {
            // Arc forbids value transfers to the zero address, so a blank row in a
            // payroll CSV would revert deep inside the token with an opaque error.
            // Catch it here so the dashboard can point at the offending row.
            if (recipients[i] == address(0)) revert InvalidParams();

            erc20.safeTransferFrom(msg.sender, recipients[i], amounts[i]);
            total += amounts[i];
        }

        emit BatchDisbursed(msg.sender, token, total, recipients.length);
    }

    // ------------------------------------------------------------------
    // VIEWS  (consumed by the Merchant Control Center)
    // ------------------------------------------------------------------

    function getVault(address user, address merchant) external view returns (Vault memory) {
        return _vaults[user][merchant];
    }

    /// @notice Whether `merchant` can pull from `user` right now.
    /// @dev Drives the enabled/disabled state of "Execute Pull" in the Subscribers view,
    ///      so the dashboard never submits a transaction it knows will revert.
    function isPullable(address user, address merchant) external view returns (bool) {
        Vault storage v = _vaults[user][merchant];
        if (!v.active) return false;
        if (v.lastPullTimestamp == 0) return true;
        return block.timestamp >= uint256(v.lastPullTimestamp) + uint256(v.intervalSeconds);
    }

    /// @notice Unix timestamp when the next pull becomes eligible.
    /// @dev Feeds the "Next Billing Date" column and the backend's due-subscription query.
    function nextPullTimestamp(address user, address merchant) external view returns (uint64) {
        Vault storage v = _vaults[user][merchant];
        if (!v.active) revert VaultNotFound();
        if (v.lastPullTimestamp == 0) return uint64(block.timestamp);
        return v.lastPullTimestamp + v.intervalSeconds;
    }
}
