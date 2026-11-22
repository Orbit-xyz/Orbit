# Subscription credential, swap, escrow, and bitmap extensions

These additions keep existing `create_vault` and `pull_funds` callers compatible.

Revenue sharing, designated recovery, elastic metered limits, and merchant-funded
sponsor reimbursement are documented in
[`REVENUE_RECOVERY_ELASTICITY_SPONSORSHIP.md`](REVENUE_RECOVERY_ELASTICITY_SPONSORSHIP.md).

## Commitment terms and recurring loyalty discounts (#337, #356)

For an existing fixed vault, the subscriber and merchant jointly authorize
`configure_cancellation_terms(user, merchant, min_commitment_ledgers,
early_cancellation_fee)`. If the subscriber cancels before the configured
ledger duration elapses, Orbit transfers the fee from the subscriber's token
allowance to the merchant before deleting the vault. Once the commitment ends,
cancellation has no fee. A failed transfer leaves the vault active.

A merchant can configure `configure_vault_loyalty_schedule(user, merchant,
tiers)` with increasing `{ cycle_count, discount_bps }` milestones. The
discount for a pull is based on previously completed successful pulls, so the
discount unlocked at cycle 3 applies starting with the next pull. The contract
emits `loyalty_milestone` when a configured threshold is reached and records
the number of successfully settled cycles in the vault.

## Soulbound membership (#123)

Creating a fixed-interval vault creates or reactivates a non-transferable
credential for the `(subscriber, merchant)` pair. It is a **contract-native
badge registry**, not a SEP-41/ERC-721 transferable asset. There is no transfer,
approve, or delegated mint method. The merchant can change its integer tier with
`set_subscriber_tier`.

Integrations can read `is_subscriber_active(user, merchant)` in one
cross-contract call. This considers the stored badge, vault presence, pause
state, and ledger-time expiry. Successful pulls extend badge validity by
`interval_seconds`. Cancellation and pause revoke the active bit. Resume
restores it. A permissionless `mark_subscription_default` synchronizes
expired badges with the packed bitmap; the one-call activity getter is always
expiration-aware without requiring a keeper.

## Packed registry (#126)

Each merchant gets monotonically assigned subscriber IDs, beginning at zero.
The badge getter exposes `subscriber_id`. Query `get_subscriber_bitmap_chunk`
with `chunk_index = subscriber_id / 256`. Bits are stored little-endian
within bytes: `byte_index = (subscriber_id % 256) / 8`, bit position
`subscriber_id % 8`. Unused chunks return 32 zero bytes. IDs are reused
for the same pair on reactivation; canceled subscribers do not shift IDs.

**Important:** the packed map is a cached operational snapshot. Because ledger
time passes without a transaction, expiring a badge cannot automatically
write its bit to zero. For authoritative eligibility, always use
`is_subscriber_active` (or call `mark_subscription_default` before reading
the bitmap for a time-based sweep). Storage TTL extension protects active
records, but archived records must be restored in long-lived deployments.

## Cross-asset settlement (#124)

The user first creates a fixed vault using the **merchant settlement token**
(e.g. USDC). Then both merchant and subscriber authorize:

`configure_swap(user, merchant, payment_token, router, max_input_amount)`.

The subscriber approves the Orbit contract to spend the maximum input amount
of its payment token (e.g. EURC). During the next `pull_funds`, Orbit
transfers at most this input to the configured Soroban router and invokes
`swap_exact_output(payment_token, settlement_token, amount_out, max_amount_in,
recipient)`. The router must implement that contract interface, pay the
specified output in settlement tokens, refund unused input back to the Orbit
contract, and return actual input spent. Orbit verifies settlement-token
balance deltas, enforces exact input accounting and the slippage cap, returns
the unused input to the subscriber, and sends the exact settlement to the
merchant or its escrow. A failed swap reverts the entire invocation.

The router receives **no allowance against Orbit's pooled escrow funds**.
The router implementation, token contracts, liquidity path, and prices must
be reviewed and trusted by both parties before enabling the route. Soroban
AMM routing is supported through this adapter interface; a native Stellar
classic-DEX path payment cannot be invoked directly as an atomic Soroban
contract call. This integration does not ship a production liquidity router.

## Dispute-protected escrow (#125)

Existing vaults continue to pay merchants immediately for backwards
compatibility. To enable dispute protection on an existing vault, both
parties authorize `configure_escrow(user, merchant, arbitrator,
escrow_window_seconds)`. A positive window is required (24 hours = 86400).

With escrow enabled, subsequent pulls transfer the settlement token into
Orbit and create an indexed `EscrowHold`, beginning at `pull_id = 0`.
The `escrow_held` event contains the pull ID and amount. A subscriber
may call `raise_dispute(user, merchant, pull_id)` before the release
timestamp. The designated arbitrator calls
`resolve_pull_dispute(arbitrator, pull_id, refund_percentage)`, with
`refund_percentage` between 0 and 100 inclusive, to split funds.
An undisputed hold becomes claimable by the merchant using
`claim_escrow_funds(merchant, pull_id)` once the window expires.
Disputed funds cannot be claimed without arbitration. The hold is removed
before token transfers and the transaction is atomic.

The arbitrator is deliberately **explicit and mutually authorized**. This
does not pretend to include decentralized arbitrator selection or bonding:
operators should use a separately governed arbitrator contract if those
guarantees are required. Preexisting escrow holds retain their original
arbitrator and deadline if the subscription configuration changes.

## Batch vault renewal (#316)

Subscribers with several active merchants can call
`batch_renew_vaults(user, merchants, extension_ledgers)` with one signature.
Each existing vault gets its `expiration_ledger` extended from the later of its
current deadline and the current ledger, plus `extension_ledgers`; its
persistent and instance storage TTLs are refreshed in the same transaction.
Missing vaults are skipped, and a consumed lifetime cap is never revived.
An expired vault with remaining cap is reactivated. One
`batch_vaults_renewed` event reports the number of renewed vaults and the
latest new deadline.

## Co-founder revenue splits (#363)

`set_revenue_splits(merchant, splits)` stores up to `MAX_REVENUE_SPLITS` (10)
`RevenueSplit { recipient, bps }` entries for a merchant. The basis points must
sum to exactly 10,000 (`RevenueSplitBpsMismatch`, error 319); an empty list, a
zero share or a repeated recipient fails with `InvalidRevenueSplit` (320).

While a config exists, `pull_funds` and `batch_pull_funds` pay each recipient
its share directly in the same invocation instead of paying the merchant.
Shares round down and the last recipient receives the remainder, so the
shares always add up to the settled amount. Plain vaults move each share
straight from the subscriber's allowance; cross-asset vaults settle into the
contract first and are then distributed. Vaults with dispute-protected escrow
keep the escrow flow. Each payment emits `revenue_split_paid` and the config's
TTL is extended on every pull. `clear_revenue_splits` returns to settling 100%
to the merchant; `get_revenue_splits` returns the current config.

## Batch vault queries (#362)

`get_vaults_batch(user, merchants)` and `get_merchant_vaults_batch(merchant,
users)` return one `Option<VaultData>` per input address, in input order, with
`None` for pairs that have no vault. Expired vaults are returned with
`payment_status == PAYMENT_EXPIRED`. Both are read-only (no auth, writes or
events) and accept at most `MAX_BATCH_VAULT_QUERY` (50) addresses per call.

## Verification

From `contracts/soroban`, run:

```sh
cargo test --locked
cargo clippy --all-targets --locked -- -D warnings
```

CI runs both commands for contract changes.
