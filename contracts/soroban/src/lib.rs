#![no_std]
#![allow(deprecated)]
#![allow(clippy::too_many_arguments)]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, token, Address, Bytes, BytesN, Env, String, Symbol, Vec,
};

/// Approximate duration of one Stellar ledger in seconds (~5 seconds per ledger).
pub const SECONDS_PER_LEDGER: u64 = 5;

// ----------------------------------------------------------------------------
// CONSTANTS: STATE ARCHIVAL & TTL MANAGEMENT
// ----------------------------------------------------------------------------

/// Safety margin added to interval ledgers (approx. 7 days = 120,960 ledgers)
/// to ensure vaults remain active even if automated pulls are delayed.
pub const TTL_MARGIN_LEDGERS: u32 = 120_960;

// Base minimum TTL duration in ledgers (approx. 30 days = 518,400 ledgers).
pub const MIN_TTL_LEDGERS: u32 = 518_400;

// Threshold in ledgers below which TTL will be extended (approx. 7 days = 120,960 ledgers).
pub const TTL_THRESHOLD_LEDGERS: u32 = 120_960;
pub const DEFAULT_GRACE_PERIOD_SECONDS: u64 = 3 * 24 * 60 * 60;
pub const PAYMENT_ACTIVE: u32 = 0;
pub const PAYMENT_GRACE_PERIOD: u32 = 1;
pub const PAYMENT_DEFAULTED: u32 = 2;
/// Terminal state once a vault's ledger expiration or lifetime cap is reached.
pub const PAYMENT_EXPIRED: u32 = 3;
pub const PAYMENT_CANCELLED: u32 = 4;
pub const PRUNE_EXPIRATION_THRESHOLD_LEDGERS: u32 = 172_800;

/// Explicit unbounded sentinels: ledger 0 is never reached by a live network,
/// and -1 is the only negative lifetime cap accepted by validation.
pub const UNLIMITED_EXPIRATION_LEDGER: u32 = 0;
pub const UNLIMITED_LIFETIME_CAP: i128 = -1;

/// Domain separator for the canonical Merkle reward leaf preimage.
pub const REWARD_LEAF_DOMAIN: &[u8] = b"orbit:reward:leaf:v1";

/// Structured errors for the #300/#302 features. Existing entrypoints keep
/// their historical assertion messages; new guards expose stable codes.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OrbitContractError {
    InvalidMerkleProof = 300,
    AlreadyClaimed = 301,
    MissingMerkleRoot = 302,
    InvalidRewardAmount = 303,
    UnauthorizedRootUpdate = 304,
    InvalidMerkleRoot = 305,
    VaultExpired = 306,
    LifetimeCapExceeded = 307,
    InvalidVaultLimit = 308,
    /// #223: fund-moving entrypoints are disabled by the circuit breaker.
    EmergencyPaused = 309,
    /// #226: a pull would breach the rolling-window cumulative cap.
    RateLimitExceeded = 310,
    /// #226: invalid window duration or cumulative ceiling.
    InvalidRateLimit = 311,
    /// #224: fee basis points exceed the 10% ceiling.
    InvalidFeeConfig = 312,
    /// #223: caller is not the configured protocol admin.
    UnauthorizedAdmin = 313,
    /// #225: malformed milestone escrow configuration.
    InvalidMilestoneEscrow = 314,
    /// #225: milestone already released or escrow finalized.
    MilestoneAlreadyReleased = 315,
    /// #225: dispute resolution attempted on a non-disputed escrow.
    MilestoneNotDisputed = 316,
    /// #225: dispute splits do not add up to the remaining balance.
    InvalidDisputeSplit = 317,
    /// #353: the vault is frozen, either by its subscriber (`pause_vault`) or by
    /// the merchant (`batch_pause_vaults`). Pulls revert with this code.
    VaultPaused = 318,
    /// #363: revenue split basis points do not add up to exactly 10,000.
    RevenueSplitBpsMismatch = 319,
    /// #363: revenue split list is empty, too long, has a zero share or a
    /// duplicate recipient.
    InvalidRevenueSplit = 320,
}

/// Sentinel `pull_sequence` for a vault that has never settled a pull.
/// Lets the very first pull through while every later pull must advance the
/// monotonic billing epoch (`cycle_index > pull_sequence`).
pub const PULL_SEQUENCE_UNSET: u64 = u64::MAX;

/// Upper bound on a payroll proposal's approver list, keeping approval checks and
/// proposal storage within Soroban resource limits.
pub const MAX_PAYROLL_APPROVERS: u32 = 20;

/// Upper bound on a `batch_pull_funds` subscriber list (#92). Caps the ledger
/// work of a single transaction so a merchant with hundreds of due subscribers
/// can page through them in bounded batches.
pub const MAX_BATCH_PULL_SUBSCRIBERS: u32 = 50;

/// Fixed-point precision used by revenue pools when accumulating dividends.
pub const REVENUE_ACC_SCALE: i128 = 1_000_000_000_000;

/// Keeps revenue-pool creation and claim lookups within predictable resource bounds.
pub const MAX_REVENUE_POOL_SHAREHOLDERS: u32 = 100;

/// Upper bound on co-founder revenue split recipients (#363).
pub const MAX_REVENUE_SPLITS: u32 = 10;

/// Minimum lifetime of a stored revenue split config; each pull extends it (#363).
pub const REVENUE_SPLIT_TTL_SECONDS: u64 = 30 * 24 * 60 * 60;

/// Upper bound on `get_vaults_batch` / `get_merchant_vaults_batch` lookups (#362),
/// keeping a single simulation's read footprint bounded.
pub const MAX_BATCH_VAULT_QUERY: u32 = 50;

/// Upper bound on merchant-configured loyalty tiers (#180).
pub const MAX_LOYALTY_TIERS: u32 = 10;

/// Basis-point denominator for loyalty discounts (#180).
pub const BPS_DENOMINATOR: i128 = 10_000;

/// Maximum elastic allowance above a metered vault's baseline limit.
pub const MAX_OVERDRAFT_PERCENTAGE: u32 = 20;

/// Challenge period between recovery initiation and execution.
pub const RECOVERY_TIMELOCK_SECONDS: u64 = 14 * 24 * 60 * 60;

/// #224: maximum protocol treasury fee, in basis points (10%).
pub const MAX_PROTOCOL_FEE_BPS: u32 = 1_000;

/// #223: safety window after an emergency pause before a vault owner may
/// unilaterally cancel the vault and reclaim any stuck allowance (7 days).
pub const PAUSE_RECOVERY_TIMELOCK_SECONDS: u64 = 7 * 24 * 60 * 60;

/// #225: upper bound on milestone escrow stages, keeping approval bounded.
pub const MAX_MILESTONE_ESCROW_STAGES: u32 = 20;

// Calculates (threshold, extend_to) in ledgers for vault persistent storage
/// and contract instance storage based on interval_seconds.
pub fn calculate_ttl_params(interval_seconds: u64) -> (u32, u32) {
    let interval_ledgers = (interval_seconds / SECONDS_PER_LEDGER) as u32;
    let extend_to = interval_ledgers
        .saturating_add(TTL_MARGIN_LEDGERS)
        .max(MIN_TTL_LEDGERS);
    let threshold = TTL_THRESHOLD_LEDGERS.min(extend_to.saturating_sub(1));
    (threshold, extend_to)
}

// ----------------------------------------------------------------------------
// DATA STRUCTURES
// ----------------------------------------------------------------------------

/// Typed authorization a subscriber signs so a relayer can create their vault
/// without the subscriber paying network fees (#296). The subscriber signs
/// [`delegated_vault_digest`] of this payload; any account may then submit it
/// through `create_vault_delegated`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelegatedVaultAuthorization {
    /// Subscriber; must be an Ed25519 account (`G...`) so their key can sign.
    pub user: Address,
    pub merchant: Address,
    /// Token the allowance is for. Signed so a relayer cannot swap it.
    pub token: Address,
    /// Amount per billing interval, in the token's base units.
    pub amount: i128,
    /// Billing interval in ledgers (~5s each).
    pub interval_ledgers: u32,
    /// Must equal `get_user_nonce(user)`; consumed on success.
    pub nonce: u64,
    /// Last ledger sequence at which the signature is valid.
    pub expiry_ledger: u32,
}

/// A single subscriber's authorization for atomic relayer-submitted batch
/// onboarding (#379). The token and expiry are signed as well as the fields
/// in the issue scope: without them a relayer could substitute a payment asset
/// or use an authorization indefinitely.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelegatedVaultAuth {
    pub user: Address,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    pub interval_ledgers: u32,
    pub nonce: u64,
    pub expiry_ledger: u32,
    pub signature: BytesN<64>,
}

/// Cap cryptographic checks and storage writes in one batch transaction.
pub const MAX_DELEGATED_VAULT_BATCH: u32 = 20;

/// Errors returned by `create_vault_delegated` (#296).
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum DelegatedAuthError {
    /// The subscriber cannot have produced an Ed25519 signature (not an
    /// Ed25519 account address). A signature that fails verification against
    /// the subscriber's key is rejected by the host's Ed25519 check, which
    /// aborts the invocation before this error could be returned.
    InvalidSignature = 1,
    /// `nonce` is not the subscriber's current nonce: replayed or stale.
    InvalidNonce = 2,
    /// The current ledger is past `expiry_ledger`.
    SignatureExpired = 3,
    /// `amount` or `interval_ledgers` is not positive, or the interval overflows.
    InvalidAuthorization = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultKey {
    pub user: Address,
    pub merchant: Address,
}

/// Vault terms as returned by `get_vault`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultData {
    pub token: Address,
    pub amount_per_interval: i128,
    pub interval_seconds: u64,
    pub last_pull_timestamp: u64,
    pub grace_period_seconds: u64,
    pub payment_status: u32,
    /// Ledger timestamp the vault was (last) created at; anchors the billing
    /// cycle grid used by the monotonic pull epoch guard (#94).
    pub initial_timestamp: u64,
    /// Cycle index of the most recent settlement. `PULL_SEQUENCE_UNSET` until
    /// the first successful pull (#94).
    pub pull_sequence: u64,
    /// Subscriber-controlled freeze flag; blocks `pull_funds` while true (#93).
    pub is_paused: bool,
    /// Timestamp after which merchant pulls are allowed. Zero means the vault
    /// has no trial window and billing starts immediately.
    pub trial_end_timestamp: u64,
    /// Setup/onboarding fee charged on vault creation (#253)
    pub setup_fee: i128,
    /// Ledger after which pulls are rejected. 0 means unbounded (#300).
    pub expiration_ledger: u32,
    /// Maximum lifetime disbursement. `UNLIMITED_LIFETIME_CAP` means unbounded (#300).
    pub lifetime_cap_amount: i128,
    /// Cumulative amount successfully pulled so far (#300).
    pub total_pulled_amount: i128,
    /// Ledger when the current vault was created; used to enforce the minimum
    /// subscriber commitment (#356).
    pub created_ledger: u32,
    pub min_commitment_ledgers: u64,
    pub early_cancellation_fee: i128,
    /// Number of successfully settled billing pulls (#337).
    pub settled_cycle_count: u32,
    /// Per-vault discounts unlocked by completed billing cycles (#337).
    pub loyalty_discount_schedule: Vec<LoyaltyDiscountTier>,
}

/// Previous full vault layout, retained for lazy migration from contracts
/// deployed before commitment and recurring-cycle discounts were added.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultDataV1 {
    pub token: Address,
    pub amount_per_interval: i128,
    pub interval_seconds: u64,
    pub last_pull_timestamp: u64,
    pub grace_period_seconds: u64,
    pub payment_status: u32,
    pub initial_timestamp: u64,
    pub pull_sequence: u64,
    pub is_paused: bool,
    pub trial_end_timestamp: u64,
    pub setup_fee: i128,
    pub expiration_ledger: u32,
    pub lifetime_cap_amount: i128,
    pub total_pulled_amount: i128,
}

/// Exact v0.1.x vault layout. Used only to migrate vaults written before the
/// #300 fields existed; new vaults always use `VaultData`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyVaultData {
    pub token: Address,
    pub amount_per_interval: i128,
    pub interval_seconds: u64,
    pub last_pull_timestamp: u64,
    pub grace_period_seconds: u64,
    pub payment_status: u32,
    pub initial_timestamp: u64,
    pub pull_sequence: u64,
    pub is_paused: bool,
    pub trial_end_timestamp: u64,
    pub setup_fee: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamKey {
    pub id: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamData {
    pub sender: Address,
    pub recipient: Address,
    pub token: Address,
    pub deposit_amount: i128,
    pub start_time: u64,
    pub stop_time: u64,
    pub amount_withdrawn: i128,
}

#[contracttype]
pub enum StorageKey {
    NextStreamId,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentSplit {
    pub recipient: Address,
    pub amount: i128,
    /// Token contract used for this recipient's payment (#301).
    pub token: Address,
}

/// One co-founder's share of a merchant's pull revenue (#363), in basis points
/// of the settled amount. A merchant's shares must sum to exactly 10,000.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RevenueSplit {
    pub recipient: Address,
    pub bps: u32,
}

/// Per-subscriber outcome of a `batch_pull_funds` call (#92). `success` is false
/// when the subscriber was skipped (missing/inactive vault, not yet due, already
/// settled this cycle, or insufficient funds) without reverting the batch.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchPullResult {
    pub subscriber: Address,
    pub success: bool,
    /// Amount settled for this subscriber in raw token units; 0 when skipped.
    pub amount: i128,
}

/// A batch disbursement that only executes once `required_approvals` distinct
/// addresses from `approvers` have approved it.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayrollProposal {
    pub id: u64,
    pub sender: Address,
    pub token: Address,
    pub splits: Vec<PaymentSplit>,
    pub approvers: Vec<Address>,
    pub approvals: Vec<Address>,
    pub required_approvals: u32,
    pub executed: bool,
}

/// A payroll deposit held in contract escrow until the recipient claims it or the
/// sender reclaims what is left after `expiration_timestamp` (#188).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayrollEscrow {
    pub id: u64,
    pub sender: Address,
    pub recipient: Address,
    pub token: Address,
    pub total_deposited: i128,
    pub claimed_amount: i128,
    pub expiration_timestamp: u64,
    /// Set once the sender reclaims the unclaimed balance. Blocks any further
    /// claim or reclaim, so the remaining funds can never be withdrawn twice.
    pub reclaimed: bool,
}

/// A Merkle payroll distribution (#156): the sender escrows the full payroll
/// once and publishes only the Merkle root of every `(recipient, amount)`
/// allocation. Recipients then claim individually with a proof, so payroll for
/// thousands of contractors never has to fit in a single transaction.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MerklePayrollData {
    pub sender: Address,
    pub token: Address,
    pub merkle_root: BytesN<32>,
    pub total_deposited: i128,
    pub claimed_amount: i128,
    pub expiration_timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Id the next payroll proposal will receive
    NextProposalId,
    Proposal(u64),
    ProposalExpiration(u64),
    ProposalNonce(u64),
    /// Id the next payroll escrow deposit will receive
    NextPayrollEscrowId,
    PayrollEscrow(u64),
    /// #225: id the next milestone escrow will receive.
    NextMilestoneEscrowId,
    /// #225: milestone-based payroll escrow with dispute arbiter.
    MilestoneEscrow(u64),
    /// #373: dispute bond staked for a milestone escrow.
    MilestoneDisputeBond(u64),
    /// Id the next Merkle payroll distribution will receive (#156)
    NextMerklePayrollId,
    MerklePayroll(u64),
    /// Claimed flag for one leaf of a Merkle payroll: (claim_id, leaf hash)
    MerkleClaimed(u64, BytesN<32>),
    /// Router a merchant has pre-approved for cross-asset subscriptions (#191)
    TrustedSwapRouter(Address, Address),
    NextBountyId,
    Bounty(u64),
    BountyCommit(u64, Address),
    NextMilestoneProjectId,
    MilestoneProject(u64),
    /// Multi-token basket subscription vault (#166)
    BasketVault(Address, Address),
    /// Loyalty token escrow for one subscriber (#180)
    LoyaltyStake(Address),
    /// Admin governance keys (#255)
    PendingAdmin,
    ProposedAdmin,
    /// Timelock for protocol parameter updates (#255)
    TimelockQueue(Symbol),
}

/// Escrowed competitive bounty; creator cannot withdraw while it is claimable.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompetitiveBounty {
    pub creator: Address,
    pub token: Address,
    pub amount: i128,
    pub proof_hash: BytesN<32>,
    pub expires_at_ledger: u32,
    pub claimed_by: Option<Address>,
    pub cancelled: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BountyCommitment {
    pub digest: BytesN<32>,
    pub ledger: u32,
}

/// The commitment binds claimant and bounty ID, so copied reveals cannot steal rewards.
/// Preimage = domain || claimant ScVal XDR || bounty ID BE || proof length BE || proof || salt.
pub fn bounty_claim_digest(
    env: &Env,
    claimant: &Address,
    bounty_id: u64,
    proof: &Bytes,
    salt: &BytesN<32>,
) -> BytesN<32> {
    use soroban_sdk::xdr::ToXdr;
    assert!(
        !proof.is_empty() && proof.len() <= 4096,
        "invalid proof length"
    );
    let mut data = Bytes::from_slice(env, b"orbit:bounty:claim:v1");
    data.append(&claimant.clone().to_xdr(env));
    data.extend_from_array(&bounty_id.to_be_bytes());
    data.extend_from_array(&proof.len().to_be_bytes());
    data.append(proof);
    data.extend_from_array(&salt.to_array());
    env.crypto().sha256(&data).to_bytes()
}

const BOUNTY_REVEAL_DELAY: u32 = 5;

/// One stage of a fully funded, merchant-gated contractor escrow (#209).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneInput {
    pub title: String,
    pub deliverable_url: String,
    pub amount: i128,
    pub due_timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneStage {
    pub title: String,
    pub deliverable_url: String,
    pub amount: i128,
    pub due_timestamp: u64,
    pub proof_url: String,
    pub review_feedback: String,
    pub submitted: bool,
    pub released: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneProject {
    pub id: u64,
    pub merchant: Address,
    pub contractor: Address,
    pub token: Address,
    pub escrowed: i128,
    pub released_amount: i128,
    pub stages: Vec<MilestoneStage>,
}

/// Multi-token basket subscription (#166): each billing interval pulls every
/// token in `tokens` for its matching `amounts_per_interval` entry.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BasketVaultData {
    pub tokens: Vec<Address>,
    pub amounts_per_interval: Vec<i128>,
    pub interval_seconds: u64,
    pub last_pull_timestamp: u64,
}

/// Loyalty discount tier (#180): subscribers staking at least `min_lock_amount`
/// receive `discount_bps` basis points off recurring pulls.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoyaltyTier {
    pub min_lock_amount: i128,
    pub discount_bps: u32,
}

/// Progressive loyalty discount unlocked after a number of successful pulls.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoyaltyDiscountTier {
    pub cycle_count: u32,
    pub discount_bps: u32,
}

/// Loyalty tokens locked in contract escrow for one subscriber (#180).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoyaltyStake {
    pub token: Address,
    pub amount: i128,
    pub lock_until: u64,
}

/// Storage key for a metered (usage-based) vault (#46). An enum on purpose:
/// `#[contracttype]` structs encode as a map of field names without the type
/// name, so a struct with the same fields as `VaultKey` would share its storage
/// entry. The enum encodes as `["Vault", user, merchant]`, which can't collide.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MeteredVaultKey {
    /// (user, merchant)
    Vault(Address, Address),
}

/// Usage-based allowance (#46): the merchant may pull variable amounts, any
/// number of times, as long as the total within the current epoch stays at or
/// below `max_amount_per_interval`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MeteredVaultData {
    pub token: Address,
    pub max_amount_per_interval: i128,
    pub interval_seconds: u64,
    /// Ledger timestamp the current billing epoch started at.
    pub current_epoch_start: u64,
    /// Total pulled in the current epoch.
    pub epoch_spent: i128,
}

/// Storage key for the on-chain plan catalog (#95). `plan_id` is unique
/// across the contract so anyone can read a plan back with `get_plan`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlanKey {
    pub plan_id: String,
}

/// Decentralized subscription plan metadata stored on-chain (#95) so
/// third-party dApps can verify plan terms without the off-chain database.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlanData {
    pub merchant: Address,
    pub token: Address,
    pub amount_per_interval: i128,
    pub interval_seconds: u64,
    pub name: String,
    pub is_active: bool,
}

// ----------------------------------------------------------------------------
// REVENUE SHARING, RECOVERY, ELASTICITY & GAS SUBSIDY (#127-130)
// ----------------------------------------------------------------------------

/// Public revenue-pool accounting requested by #127. Shareholder membership is
/// immutable after creation so already-accrued entitlements cannot be diluted.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RevenuePool {
    pub total_shares: u32,
    pub shareholders: Vec<(Address, u32)>,
    /// Deposited tokens that have not yet been claimed. This includes any
    /// sub-token-unit dividend dust retained by fixed-point accounting.
    pub undistributed_balance: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RevenuePoolState {
    pub owner: Address,
    pub token: Address,
    pub pool: RevenuePool,
    /// Accumulated token units per share, scaled by `REVENUE_ACC_SCALE`.
    pub acc_per_share: i128,
    /// Scaled numerator remainder carried into the next deposit.
    pub scaled_remainder: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RevenueAccount {
    /// Whole token units already withdrawn by this shareholder.
    pub claimed: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultRecoveryConfig {
    pub recovery_address: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultRecoveryRequest {
    pub recovery_address: Address,
    pub initiated_at: u64,
    pub execute_after: u64,
    /// Recovery freezes billing immediately. A veto restores this prior state.
    pub was_paused: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ElasticityData {
    pub overdraft_percentage: u32,
    /// Prior-epoch overdraft deducted from this epoch's baseline.
    pub carried_overdraft: i128,
    /// Overdraft consumed above the adjusted baseline in the current epoch.
    pub epoch_overdraft: i128,
}

/// Merchant-funded reimbursement reserve for a configured transaction sponsor.
/// `native_token` must be the network's canonical native-XLM SAC address.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GasSubsidyPool {
    pub native_token: Address,
    pub sponsor: Address,
    pub balance: i128,
    pub max_subsidy_per_handshake: i128,
    pub next_nonce: u64,
    pub locked: bool,
}

/// Timelock queue entry for protocol parameter updates (#255)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TimelockEntry {
    pub param_name: Symbol,
    pub queued_at: u64,
    pub execute_after: u64,
    pub data: Bytes,
}

/// Namespaced keys prevent collisions with legacy struct-encoded storage keys.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FeatureKey {
    RevenuePool(u64),
    RevenueAccount(u64, Address),
    RecoveryConfig(Address, Address),
    RecoveryRequest(Address, Address),
    Elasticity(Address, Address),
    GasSubsidy(Address),
    YieldStrategy,
    /// Per-user meta-transaction replay nonce (#207)
    UserNonce(Address),
    /// Merchant-configured loyalty discount tiers (#180)
    LoyaltyTiers(Address),
    /// Contract admin address (#255)
    Admin,
    /// Global reward distribution root and token (#302)
    RewardMerkleRoot,
    RewardToken,
    RewardClaim(Address),
    /// Administrator authorized to rotate the reward root and fund claims. The
    /// first `set_reward_root` call bootstraps it (deferring to the global admin
    /// when one is configured); later rotations require the same address.
    RewardAdmin,
    /// Marks a vault stored with the #300 `VaultData` layout. Without it the
    /// entry is decoded as `LegacyVaultData` and migrated on first read.
    VaultLimitSchema(Address, Address),
    /// Marks the vault's commitment and cycle-discount layout.
    VaultBillingSchema(Address, Address),
    /// #223: global circuit-breaker state, stored in instance storage.
    PauseState,
    /// #226: per-vault rolling-window rate limit configuration and state.
    VaultRateLimit(Address, Address),
    /// #224: global protocol treasury fee configuration.
    ProtocolFee,
    /// #223: escrow hold ids created for a vault, so a post-timelock recovery
    /// can refund every still-pending hold to the subscriber.
    VaultEscrowIds(Address, Address),
    /// #353: merchant-initiated freeze flag for a (user, merchant) vault, set by
    /// `batch_pause_vaults`. Separate from the subscriber's `is_paused` so that
    /// neither party can lift the other's freeze.
    MerchantFreeze(Address, Address),
}

// ----------------------------------------------------------------------------
// CIRCUIT BREAKER, RATE LIMITS, PROTOCOL FEES & MILESTONE ESCROW (#223-226)
// ----------------------------------------------------------------------------

/// #223: global circuit-breaker state. Kept in instance storage so pausing and
/// resuming the whole protocol is a single cheap, atomic write.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PauseState {
    pub paused: bool,
    /// Ledger timestamp at which the current pause began. Zero while unpaused.
    pub paused_at: u64,
}

/// #226: rolling-window allowance for a fixed-interval vault. Ledger sequences
/// (not timestamps) drive the window so capacity reset is deterministic even
/// when ledger close times drift.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultRateLimit {
    pub window_duration_ledgers: u32,
    pub max_cumulative_amount: i128,
    /// Ledger at which the current window began.
    pub window_start_ledger: u32,
    /// Amount settled in the current window.
    pub window_spent: i128,
}

/// #224: optional protocol treasury fee. `fee_bps` is capped at
/// [`MAX_PROTOCOL_FEE_BPS`] when configured.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolFeeConfig {
    pub fee_bps: u32,
    pub treasury: Address,
}

/// #225: lifecycle of a milestone escrow.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MilestoneEscrowStatus {
    Pending,
    Approved,
    Disputed,
    Refunded,
    SettledMutual,
}

/// #225: milestone-based payroll escrow with an independent arbiter.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneEscrow {
    pub id: u64,
    pub employer: Address,
    pub contractor: Address,
    pub arbiter: Address,
    pub token: Address,
    pub total_amount: i128,
    pub milestone_amounts: Vec<i128>,
    /// Parallel to `milestone_amounts`; true once a milestone was paid out.
    pub released: Vec<bool>,
    pub released_amount: i128,
    pub status: MilestoneEscrowStatus,
}

/// Bond staked by a claimant when disputing a milestone escrow (#373).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeBondRecord {
    pub claimant: Address,
    pub amount: i128,
}

// ----------------------------------------------------------------------------
// YIELD-BEARING COLLATERAL STRATEGY (#176)
// ----------------------------------------------------------------------------

/// Configuration for the yield strategy adapter. Stores the approved lending
/// pool where idle escrow balances are deployed to generate passive yield.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct YieldStrategyConfig {
    pub yield_pool: Option<Address>,
    pub token: Address,
    pub liquidity_buffer: i128,
    pub total_deployed: i128,
}

/// A trusted Soroban lending market (e.g., Blend Protocol) that accepts token
/// deposits, accrues interest, and allows atomic redemption of principal + yield.
#[contractclient(name = "LendingPoolClient")]
pub trait LendingPool {
    fn supply(env: Env, token: Address, amount: i128, from: Address);
    fn withdraw(env: Env, token: Address, amount: i128, to: Address) -> i128;
    fn balance_of(env: Env, token: Address, account: Address) -> i128;
}

// ----------------------------------------------------------------------------
// SUBSCRIPTION CREDENTIALS, BITMAP INDEX, PAYMENT ROUTING & ESCROW (#123–126)
// ----------------------------------------------------------------------------

pub const DEFAULT_ESCROW_WINDOW_SECONDS: u64 = 86_400;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SubscriptionKey {
    Badge(Address, Address),
    NextId(Address),
    Bitmap(Address, u32),
    Swap(Address, Address),
    EscrowPolicy(Address, Address),
    Escrow(u64),
    NextEscrowId,
    /// #363: co-founder revenue splits for a merchant's pull settlements.
    RevenueSplits(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BadgeData {
    pub active: bool,
    pub tier: u32,
    pub expiration_timestamp: u64,
    pub subscriber_id: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SwapConfig {
    pub payment_token: Address,
    pub settlement_token: Address,
    pub router: Address,
    pub max_input_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowPolicy {
    pub arbitrator: Address,
    pub window_seconds: u64,
    pub dispute_timeout_ledgers: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowHold {
    pub user: Address,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    pub release_at: u64,
    pub arbitrator: Address,
    pub disputed: bool,
    pub dispute_started_ledger: u32,
    pub dispute_timeout_ledgers: u32,
}

/// A trusted Soroban AMM router receives only the exact reserved input transferred
/// for this swap (never an approval to drain pooled escrow holdings), sends
/// settlement tokens to `recipient`, refunds unused input, and reports spent input.
/// It must execute atomically and enforce its own route/oracle protections.
#[contractclient(name = "SwapRouterClient")]
pub trait SwapRouter {
    fn swap_exact_output(
        env: Env,
        payment_token: Address,
        settlement_token: Address,
        amount_out: i128,
        max_amount_in: i128,
        recipient: Address,
    ) -> i128;
}

fn extend_key(env: &Env, key: &SubscriptionKey, interval: u64) {
    let (threshold, extend_to) = calculate_ttl_params(interval);
    env.storage()
        .persistent()
        .extend_ttl(key, threshold, extend_to);
}

fn bitmap_status(env: &Env, merchant: &Address, id: u32, active: bool, interval: u64) {
    let key = SubscriptionKey::Bitmap(merchant.clone(), id / 256);
    let mut bytes = env
        .storage()
        .persistent()
        .get::<_, BytesN<32>>(&key)
        .unwrap_or_else(|| BytesN::from_array(env, &[0u8; 32]))
        .to_array();
    let offset = ((id % 256) / 8) as usize;
    let mask = 1u8 << (id % 8);
    if active {
        bytes[offset] |= mask;
    } else {
        bytes[offset] &= !mask;
    }
    env.storage()
        .persistent()
        .set(&key, &BytesN::from_array(env, &bytes));
    extend_key(env, &key, interval);
}

fn activate_badge(
    env: &Env,
    user: &Address,
    merchant: &Address,
    tier: u32,
    until: u64,
    interval: u64,
) {
    let key = SubscriptionKey::Badge(user.clone(), merchant.clone());
    let id = if let Some(existing) = env.storage().persistent().get::<_, BadgeData>(&key) {
        existing.subscriber_id
    } else {
        let next_key = SubscriptionKey::NextId(merchant.clone());
        let next: u32 = env.storage().persistent().get(&next_key).unwrap_or(0);
        env.storage().persistent().set(
            &next_key,
            &next.checked_add(1).expect("Subscriber ID exhausted"),
        );
        extend_key(env, &next_key, interval);
        next
    };
    env.storage().persistent().set(
        &key,
        &BadgeData {
            active: true,
            tier,
            expiration_timestamp: until,
            subscriber_id: id,
        },
    );
    extend_key(env, &key, interval);
    bitmap_status(env, merchant, id, true, interval);
}

fn deactivate_badge(env: &Env, user: &Address, merchant: &Address, interval: u64) {
    let key = SubscriptionKey::Badge(user.clone(), merchant.clone());
    if let Some(mut badge) = env.storage().persistent().get::<_, BadgeData>(&key) {
        badge.active = false;
        env.storage().persistent().set(&key, &badge);
        extend_key(env, &key, interval);
        bitmap_status(env, merchant, badge.subscriber_id, false, interval);
    }
}

/// Performs exact-output conversion into the vault settlement token.
/// Input is collected from the subscriber before invoking the approved router;
/// failure to receive the full output reverts the whole Soroban invocation.
fn pull_payment(
    env: &Env,
    user: &Address,
    merchant: &Address,
    vault: &VaultData,
    recipient: &Address,
) {
    let config_key = SubscriptionKey::Swap(user.clone(), merchant.clone());
    if let Some(config) = env.storage().persistent().get::<_, SwapConfig>(&config_key) {
        assert!(
            config.settlement_token == vault.token,
            "Wrong settlement token"
        );
        assert!(
            config.payment_token != config.settlement_token,
            "Swap requires distinct tokens"
        );
        assert!(config.max_input_amount > 0, "Invalid maximum input");
        let contract = env.current_contract_address();
        let input = token::Client::new(env, &config.payment_token);
        let output = token::Client::new(env, &config.settlement_token);
        let input_before = input.balance(&contract);
        let output_before = output.balance(&contract);
        input.transfer_from(&contract, user, &config.router, &config.max_input_amount);
        let spent = SwapRouterClient::new(env, &config.router).swap_exact_output(
            &config.payment_token,
            &config.settlement_token,
            &vault.amount_per_interval,
            &config.max_input_amount,
            &contract,
        );
        assert!(
            spent > 0 && spent <= config.max_input_amount,
            "Slippage limit exceeded"
        );
        let received = output.balance(&contract) - output_before;
        assert!(
            received >= vault.amount_per_interval,
            "Insufficient settlement output"
        );
        let unspent = input.balance(&contract) - input_before;
        assert!(
            unspent >= 0 && unspent <= config.max_input_amount,
            "Invalid swap input refund"
        );
        assert!(
            config.max_input_amount - unspent == spent,
            "Router input accounting mismatch"
        );
        if unspent > 0 {
            input.transfer(&contract, user, &unspent);
        }
        if received > vault.amount_per_interval {
            output.transfer(&contract, user, &(received - vault.amount_per_interval));
        }
        // Escrow settlement is already held by this contract; avoid a
        // redundant self-transfer and keep the received balance unchanged.
        if recipient != &contract {
            output.transfer(&contract, recipient, &vault.amount_per_interval);
        }
        extend_key(env, &config_key, vault.interval_seconds);
    } else {
        token::Client::new(env, &vault.token).transfer_from(
            &env.current_contract_address(),
            user,
            recipient,
            &vault.amount_per_interval,
        );
    }
}

/// #363: reject split configs that would not conserve funds exactly.
fn validate_revenue_splits(env: &Env, splits: &Vec<RevenueSplit>) {
    if splits.is_empty() || splits.len() > MAX_REVENUE_SPLITS {
        panic_with_error!(env, OrbitContractError::InvalidRevenueSplit);
    }
    let mut total: u64 = 0;
    for (i, split) in splits.iter().enumerate() {
        if split.bps == 0 {
            panic_with_error!(env, OrbitContractError::InvalidRevenueSplit);
        }
        for earlier in splits.iter().take(i) {
            if earlier.recipient == split.recipient {
                panic_with_error!(env, OrbitContractError::InvalidRevenueSplit);
            }
        }
        total += u64::from(split.bps);
    }
    if total != BPS_DENOMINATOR as u64 {
        panic_with_error!(env, OrbitContractError::RevenueSplitBpsMismatch);
    }
}

/// #363: each recipient's share of `amount`, rounded down; the last recipient
/// takes the rounding remainder so the shares always sum to `amount`.
fn revenue_split_shares(env: &Env, amount: i128, splits: &Vec<RevenueSplit>) -> Vec<i128> {
    let mut shares = Vec::new(env);
    let mut allocated: i128 = 0;
    let last = splits.len() - 1;
    for (i, split) in splits.iter().enumerate() {
        let share = if i as u32 == last {
            amount - allocated
        } else {
            amount
                .checked_mul(i128::from(split.bps))
                .expect("Revenue split overflow")
                / BPS_DENOMINATOR
        };
        allocated += share;
        shares.push_back(share);
    }
    shares
}

/// Settle a pull that is not held in escrow. Without a revenue split config the
/// merchant receives everything; with one, each co-founder is paid their share
/// directly in the same invocation (#363).
fn settle_pull(env: &Env, user: &Address, merchant: &Address, vault: &VaultData) {
    let splits_key = SubscriptionKey::RevenueSplits(merchant.clone());
    let splits: Vec<RevenueSplit> = env
        .storage()
        .persistent()
        .get(&splits_key)
        .unwrap_or_else(|| Vec::new(env));
    if splits.is_empty() {
        pull_payment(env, user, merchant, vault, merchant);
        return;
    }

    let contract = env.current_contract_address();
    let token = token::Client::new(env, &vault.token);
    // A cross-asset vault settles into this contract first; plain vaults move
    // each share straight from the subscriber's allowance.
    let via_swap = env
        .storage()
        .persistent()
        .has(&SubscriptionKey::Swap(user.clone(), merchant.clone()));
    if via_swap {
        pull_payment(env, user, merchant, vault, &contract);
    }
    let shares = revenue_split_shares(env, vault.amount_per_interval, &splits);
    for (split, share) in splits.iter().zip(shares.iter()) {
        if share == 0 {
            continue;
        }
        if via_swap {
            token.transfer(&contract, &split.recipient, &share);
        } else {
            token.transfer_from(&contract, user, &split.recipient, &share);
        }
        env.events().publish(
            (
                Symbol::new(env, "revenue_split_paid"),
                merchant.clone(),
                split.recipient.clone(),
            ),
            share,
        );
    }
    extend_key(env, &splits_key, vault.interval_seconds);
}

fn store_escrow(
    env: &Env,
    user: &Address,
    merchant: &Address,
    vault: &VaultData,
    policy: &EscrowPolicy,
) -> u64 {
    let counter_key = SubscriptionKey::NextEscrowId;
    let next: u64 = env.storage().instance().get(&counter_key).unwrap_or(0);
    env.storage().instance().set(
        &counter_key,
        &next.checked_add(1).expect("Escrow ID exhausted"),
    );
    let hold_key = SubscriptionKey::Escrow(next);
    let hold = EscrowHold {
        user: user.clone(),
        merchant: merchant.clone(),
        token: vault.token.clone(),
        amount: vault.amount_per_interval,
        release_at: env
            .ledger()
            .timestamp()
            .saturating_add(policy.window_seconds),
        arbitrator: policy.arbitrator.clone(),
        disputed: false,
        dispute_started_ledger: 0,
        dispute_timeout_ledgers: policy.dispute_timeout_ledgers,
    };
    env.storage().persistent().set(&hold_key, &hold);
    // Track holds per vault so a #223 post-timelock recovery can refund every
    // still-pending hold to the subscriber.
    let ids_key = FeatureKey::VaultEscrowIds(user.clone(), merchant.clone());
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&ids_key)
        .unwrap_or_else(|| Vec::new(env));
    ids.push_back(next);
    env.storage().persistent().set(&ids_key, &ids);
    extend_key(env, &hold_key, policy.window_seconds);
    next
}

// ----------------------------------------------------------------------------
// STORAGE LAYOUT
// ----------------------------------------------------------------------------
//
// Vaults live in persistent storage for the lifetime of the subscription. The
// key is the `VaultKey` struct and the value is the full `VaultData` record.

fn vault_key(user: &Address, merchant: &Address) -> VaultKey {
    VaultKey {
        user: user.clone(),
        merchant: merchant.clone(),
    }
}

/// Marker distinguishing the extended #300 `VaultData` layout from v0.1.x
/// entries that only contain the original fields.
fn vault_schema_key(key: &VaultKey) -> FeatureKey {
    FeatureKey::VaultLimitSchema(key.user.clone(), key.merchant.clone())
}

fn vault_billing_schema_key(key: &VaultKey) -> FeatureKey {
    FeatureKey::VaultBillingSchema(key.user.clone(), key.merchant.clone())
}

fn load_vault(env: &Env, key: &VaultKey) -> Option<VaultData> {
    let storage = env.storage().persistent();
    if storage.has(&vault_billing_schema_key(key)) {
        return storage.get(key);
    }
    let make_current = |token,
                        amount_per_interval,
                        interval_seconds,
                        last_pull_timestamp,
                        grace_period_seconds,
                        payment_status,
                        initial_timestamp,
                        pull_sequence,
                        is_paused,
                        trial_end_timestamp,
                        setup_fee,
                        expiration_ledger,
                        lifetime_cap_amount,
                        total_pulled_amount| VaultData {
        token,
        amount_per_interval,
        interval_seconds,
        last_pull_timestamp,
        grace_period_seconds,
        payment_status,
        initial_timestamp,
        pull_sequence,
        is_paused,
        trial_end_timestamp,
        setup_fee,
        expiration_ledger,
        lifetime_cap_amount,
        total_pulled_amount,
        created_ledger: 0,
        min_commitment_ledgers: 0,
        early_cancellation_fee: 0,
        settled_cycle_count: 0,
        loyalty_discount_schedule: Vec::new(env),
    };
    if storage.has(&vault_schema_key(key)) {
        return storage.get::<_, VaultDataV1>(key).map(|previous| {
            make_current(
                previous.token,
                previous.amount_per_interval,
                previous.interval_seconds,
                previous.last_pull_timestamp,
                previous.grace_period_seconds,
                previous.payment_status,
                previous.initial_timestamp,
                previous.pull_sequence,
                previous.is_paused,
                previous.trial_end_timestamp,
                previous.setup_fee,
                previous.expiration_ledger,
                previous.lifetime_cap_amount,
                previous.total_pulled_amount,
            )
        });
    }
    // Older vaults predate the lifetime-cap fields and are migrated as unbounded.
    storage.get::<_, LegacyVaultData>(key).map(|legacy| {
        make_current(
            legacy.token,
            legacy.amount_per_interval,
            legacy.interval_seconds,
            legacy.last_pull_timestamp,
            legacy.grace_period_seconds,
            legacy.payment_status,
            legacy.initial_timestamp,
            legacy.pull_sequence,
            legacy.is_paused,
            legacy.trial_end_timestamp,
            legacy.setup_fee,
            UNLIMITED_EXPIRATION_LEDGER,
            UNLIMITED_LIFETIME_CAP,
            0,
        )
    })
}

fn save_vault(env: &Env, key: &VaultKey, vault: &VaultData) {
    env.storage().persistent().set(key, vault);
    let schema_key = vault_schema_key(key);
    env.storage().persistent().set(&schema_key, &true);
    let billing_schema_key = vault_billing_schema_key(key);
    env.storage()
        .persistent()
        .set(&billing_schema_key, &true);
    let (threshold, extend_to) = calculate_ttl_params(vault.interval_seconds);
    env.storage()
        .persistent()
        .extend_ttl(&schema_key, threshold, extend_to);
    env.storage()
        .persistent()
        .extend_ttl(&billing_schema_key, threshold, extend_to);
}

/// 0 ledger and -1 amount are the explicit unbounded sentinels. Any other
/// past/current ledger or non-positive cap is invalid configuration.
fn validate_vault_limits(
    env: &Env,
    expiration_ledger: u32,
    lifetime_cap_amount: i128,
    sequence: u32,
) {
    if expiration_ledger != UNLIMITED_EXPIRATION_LEDGER && expiration_ledger <= sequence {
        panic_with_error!(env, OrbitContractError::InvalidVaultLimit);
    }
    if lifetime_cap_amount != UNLIMITED_LIFETIME_CAP && lifetime_cap_amount <= 0 {
        panic_with_error!(env, OrbitContractError::InvalidVaultLimit);
    }
}

/// Whether a pull must be rejected for the #300 guards. The terminal status is
/// sticky even if the ledger clock is later rewound.
fn vault_is_expired(env: &Env, vault: &VaultData) -> bool {
    vault.payment_status == PAYMENT_EXPIRED
        || (vault.expiration_ledger != UNLIMITED_EXPIRATION_LEDGER
            && env.ledger().sequence() >= vault.expiration_ledger)
}

/// The amount still available under the lifetime cap, or `None` if unbounded.
fn remaining_vault_cap(vault: &VaultData) -> Option<i128> {
    if vault.lifetime_cap_amount == UNLIMITED_LIFETIME_CAP {
        return None;
    }
    Some(vault.lifetime_cap_amount - vault.total_pulled_amount)
}

fn mark_vault_expired(env: &Env, key: &VaultKey, vault: &VaultData) {
    let mut expired = vault.clone();
    expired.payment_status = PAYMENT_EXPIRED;
    save_vault(env, key, &expired);
    env.events().publish(
        (
            Symbol::new(env, "vault_expired"),
            key.user.clone(),
            key.merchant.clone(),
        ),
        (expired.total_pulled_amount, env.ledger().sequence()),
    );
}

fn extend_feature_key(env: &Env, key: &FeatureKey, lifetime_seconds: u64) {
    let (threshold, extend_to) = calculate_ttl_params(lifetime_seconds);
    env.storage()
        .persistent()
        .extend_ttl(key, threshold, extend_to);
}

// ----------------------------------------------------------------------------
// #223: EMERGENCY PAUSE HELPERS
// ----------------------------------------------------------------------------

fn load_pause_state(env: &Env) -> PauseState {
    env.storage()
        .instance()
        .get(&FeatureKey::PauseState)
        .unwrap_or(PauseState {
            paused: false,
            paused_at: 0,
        })
}

fn save_pause_state(env: &Env, state: &PauseState) {
    env.storage().instance().set(&FeatureKey::PauseState, state);
    // The flag must outlive the recovery timelock so a paused protocol can
    // always be unpaused (or recovered from) rather than silently reverting to
    // the default "running" state when instance storage expires.
    let (threshold, extend_to) = calculate_ttl_params(PAUSE_RECOVERY_TIMELOCK_SECONDS);
    env.storage().instance().extend_ttl(threshold, extend_to);
}

fn assert_not_paused(env: &Env) {
    if load_pause_state(env).paused {
        panic_with_error!(env, OrbitContractError::EmergencyPaused);
    }
}

/// #353: whether the merchant has frozen this (user, merchant) vault.
fn is_merchant_frozen(env: &Env, user: &Address, merchant: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&FeatureKey::MerchantFreeze(user.clone(), merchant.clone()))
        .unwrap_or(false)
}

/// #353: reverts with `VaultPaused` if either the subscriber or the merchant has
/// frozen the vault. Used by every single-vault pull path.
fn assert_vault_not_paused(env: &Env, vault: &VaultData, user: &Address, merchant: &Address) {
    if vault.is_paused || is_merchant_frozen(env, user, merchant) {
        panic_with_error!(env, OrbitContractError::VaultPaused);
    }
}

/// #353: sets or clears the merchant freeze on every listed subscriber vault in
/// one pass. Atomic: a missing vault reverts the whole batch, so a merchant can
/// only ever change vaults keyed to its own address (vault keys are
/// `(user, merchant)`). Returns the number of vaults touched.
fn apply_merchant_freeze(
    env: &Env,
    merchant: &Address,
    subscribers: &Vec<Address>,
    frozen: bool,
) -> u32 {
    assert!(!subscribers.is_empty(), "subscribers must not be empty");
    assert!(
        subscribers.len() <= MAX_BATCH_PULL_SUBSCRIBERS,
        "batch size exceeds MAX_BATCH_PULL_SUBSCRIBERS"
    );

    let now = env.ledger().timestamp();
    let mut touched: u32 = 0;
    for user in subscribers.iter() {
        let key = vault_key(&user, merchant);
        let mut vault = load_vault(env, &key).expect("Vault does not exist");
        let freeze_key = FeatureKey::MerchantFreeze(user.clone(), merchant.clone());

        if frozen {
            env.storage().persistent().set(&freeze_key, &true);
        } else {
            env.storage().persistent().remove(&freeze_key);
            // Unfreezing restores pull eligibility. Like `resume_vault`, the
            // billing clock restarts at unfreeze so the frozen period is not
            // back-billed. A never-pulled vault (timestamp 0) keeps its immediate
            // first-pull eligibility. A subscriber-initiated pause still applies.
            if !vault.is_paused && vault.last_pull_timestamp != 0 {
                vault.last_pull_timestamp = now;
                save_vault(env, &key, &vault);
            }
        }

        let (threshold, extend_to) = calculate_ttl_params(vault.interval_seconds);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold, extend_to);
        if frozen {
            env.storage()
                .persistent()
                .extend_ttl(&freeze_key, threshold, extend_to);
        }

        let event = if frozen {
            Symbol::new(env, "vault_frozen_by_merchant")
        } else {
            Symbol::new(env, "vault_unfrozen_by_merchant")
        };
        env.events()
            .publish((event, user.clone(), merchant.clone()), ());
        touched += 1;
    }
    touched
}

/// Require the caller to be the configured protocol admin. The first caller
/// bootstraps the admin slot; every later call must match the stored address.
fn bootstrap_or_require_admin(env: &Env, caller: &Address) {
    caller.require_auth();
    let key = FeatureKey::Admin;
    match env.storage().persistent().get::<_, Address>(&key) {
        Some(admin) if admin == *caller => (),
        Some(_) => panic_with_error!(env, OrbitContractError::UnauthorizedAdmin),
        None => {
            env.storage().persistent().set(&key, caller);
            extend_feature_key(env, &key, PAUSE_RECOVERY_TIMELOCK_SECONDS);
            env.events()
                .publish((symbol_short!("admin_set"), caller.clone()), ());
        }
    }
}

// ----------------------------------------------------------------------------
// #226: SLIDING-Window RATE LIMIT HELPERS
// ----------------------------------------------------------------------------

fn rate_limit_key(user: &Address, merchant: &Address) -> FeatureKey {
    FeatureKey::VaultRateLimit(user.clone(), merchant.clone())
}

/// Charge `amount` against the vault's rolling window. When the window has
/// elapsed, previously spent capacity decays to zero before the check, so a
/// merchant can bill again without a new vault-creation transaction.
fn consume_rate_limit(env: &Env, user: &Address, merchant: &Address, amount: i128) {
    let key = rate_limit_key(user, merchant);
    let Some(mut limit) = env.storage().persistent().get::<_, VaultRateLimit>(&key) else {
        return;
    };
    let now = env.ledger().sequence();
    let window_end = limit
        .window_start_ledger
        .saturating_add(limit.window_duration_ledgers);
    // Ledger 0 is a perfectly valid window start, so only the sequence
    // comparison (never a sentinel) decides when capacity decays.
    if now >= window_end {
        limit.window_start_ledger = now;
        limit.window_spent = 0;
    }
    let proposed = limit
        .window_spent
        .checked_add(amount)
        .expect("Rate-limit accumulation overflow");
    if proposed > limit.max_cumulative_amount {
        panic_with_error!(env, OrbitContractError::RateLimitExceeded);
    }
    limit.window_spent = proposed;
    env.storage().persistent().set(&key, &limit);
    extend_feature_key(
        env,
        &key,
        u64::from(limit.window_duration_ledgers) * SECONDS_PER_LEDGER,
    );
    env.events().publish(
        (
            Symbol::new(env, "rate_window_spent"),
            user.clone(),
            merchant.clone(),
        ),
        (limit.window_spent, limit.max_cumulative_amount, now),
    );
}

// ----------------------------------------------------------------------------
// #224: PROTOCOL TREASURY FEE HELPERS
// ----------------------------------------------------------------------------

fn load_protocol_fee(env: &Env) -> Option<ProtocolFeeConfig> {
    env.storage().persistent().get(&FeatureKey::ProtocolFee)
}

/// Fee for one split, rounded down in the token's base units.
fn protocol_fee_for(amount: i128, fee_bps: u32) -> i128 {
    amount
        .checked_mul(i128::from(fee_bps))
        .expect("Protocol fee multiplication overflow")
        / BPS_DENOMINATOR
}

/// Deduct the configured fee from every split so total allowance never has to
/// exceed the original batch amount. Returns the net splits, per-token fee
/// totals, and the applied configuration (for event emission).
fn apply_protocol_fees(
    env: &Env,
    splits: Vec<PaymentSplit>,
) -> (
    Vec<PaymentSplit>,
    Vec<(Address, i128)>,
    Option<ProtocolFeeConfig>,
) {
    let Some(config) = load_protocol_fee(env) else {
        return (splits, Vec::new(env), None);
    };
    // Zero-bps / unconfigured fee is a straight pass-through with no overhead.
    if config.fee_bps == 0 {
        return (splits, Vec::new(env), None);
    }
    let mut net_splits = Vec::new(env);
    let mut fee_splits = Vec::new(env);
    for split in splits.iter() {
        let fee = protocol_fee_for(split.amount, config.fee_bps);
        net_splits.push_back(PaymentSplit {
            recipient: split.recipient.clone(),
            amount: split.amount.checked_sub(fee).expect("Fee exceeds split"),
            token: split.token.clone(),
        });
        fee_splits.push_back(PaymentSplit {
            recipient: config.treasury.clone(),
            amount: fee,
            token: split.token.clone(),
        });
    }
    let fee_totals = payroll_totals(env, &fee_splits);
    (net_splits, fee_totals, Some(config))
}

/// Transfer accumulated fees to the treasury and publish the transparency
/// event required by #224.
fn settle_protocol_fees(
    env: &Env,
    sender: &Address,
    fee_totals: &Vec<(Address, i128)>,
    config: &ProtocolFeeConfig,
) {
    for (token, fee) in fee_totals.iter() {
        if fee <= 0 {
            continue;
        }
        token::Client::new(env, &token).transfer_from(
            &env.current_contract_address(),
            sender,
            &config.treasury,
            &fee,
        );
        env.events()
            .publish((symbol_short!("fee"), config.treasury.clone()), fee);
    }
}

// ----------------------------------------------------------------------------
// #225: MILESTONE ESCROW HELPERS
// ----------------------------------------------------------------------------

fn load_milestone_escrow(env: &Env, escrow_id: u64) -> MilestoneEscrow {
    env.storage()
        .persistent()
        .get(&DataKey::MilestoneEscrow(escrow_id))
        .expect("Milestone escrow does not exist")
}

fn save_milestone_escrow(env: &Env, escrow: &MilestoneEscrow) {
    env.storage()
        .persistent()
        .set(&DataKey::MilestoneEscrow(escrow.id), escrow);
    // Milestone payouts can be spread over a long delivery schedule.
    env.storage().persistent().extend_ttl(
        &DataKey::MilestoneEscrow(escrow.id),
        TTL_THRESHOLD_LEDGERS,
        MIN_TTL_LEDGERS,
    );
}

fn shareholder_weight(state: &RevenuePoolState, shareholder: &Address) -> u32 {
    for entry in state.pool.shareholders.iter() {
        if entry.0 == *shareholder {
            return entry.1;
        }
    }
    panic!("Address is not a shareholder")
}

fn clear_recovery_state(env: &Env, user: &Address, merchant: &Address) {
    env.storage()
        .persistent()
        .remove(&FeatureKey::RecoveryConfig(user.clone(), merchant.clone()));
    env.storage()
        .persistent()
        .remove(&FeatureKey::RecoveryRequest(user.clone(), merchant.clone()));
}

/// Removes the fixed-interval and/or metered vault for (user, merchant) and
/// emits `vault_cancelled`. Shared by direct and delegated cancellation.
fn remove_vault(env: &Env, user: &Address, merchant: &Address) {
    let key = vault_key(user, merchant);
    env.storage()
        .persistent()
        .remove(&FeatureKey::MerchantFreeze(user.clone(), merchant.clone()));
    let metered_key = MeteredVaultKey::Vault(user.clone(), merchant.clone());

    let has_fixed = env.storage().persistent().has(&key);
    let has_metered = env.storage().persistent().has(&metered_key);
    assert!(has_fixed || has_metered, "Vault does not exist");

    if has_fixed {
        let vault = load_vault(env, &key).expect("Vault missing");
        let commitment_end = u64::from(vault.created_ledger)
            .saturating_add(vault.min_commitment_ledgers);
        if u64::from(env.ledger().sequence()) < commitment_end
            && vault.early_cancellation_fee > 0
        {
            token::Client::new(env, &vault.token).transfer_from(
                &env.current_contract_address(),
                user,
                merchant,
                &vault.early_cancellation_fee,
            );
            env.events().publish(
                (
                    Symbol::new(env, "early_cancel_fee"),
                    user.clone(),
                    merchant.clone(),
                ),
                vault.early_cancellation_fee,
            );
        }
        deactivate_badge(env, user, merchant, vault.interval_seconds);
        env.storage().persistent().remove(&key);
        env.storage().persistent().remove(&vault_schema_key(&key));
        env.storage()
            .persistent()
            .remove(&vault_billing_schema_key(&key));
        env.storage()
            .persistent()
            .remove(&SubscriptionKey::Swap(user.clone(), merchant.clone()));
        env.storage()
            .persistent()
            .remove(&SubscriptionKey::EscrowPolicy(
                user.clone(),
                merchant.clone(),
            ));
    }
    if has_metered {
        env.storage().persistent().remove(&metered_key);
        env.storage()
            .persistent()
            .remove(&FeatureKey::Elasticity(user.clone(), merchant.clone()));
    }
    clear_recovery_state(env, user, merchant);

    env.events()
        .publish((Symbol::new(env, "vault_cancelled"), user, merchant), ());
}

// ----------------------------------------------------------------------------
// DELEGATED DISBURSE STRUCTURES
// ----------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisbursalNonce {
    pub sender: Address,
    pub nonce: u64,
}

/// #345: Off-chain cryptographic signature from a verified treasury signer.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerSignature {
    pub signer: Address,
    pub signature: BytesN<64>,
}

// ----------------------------------------------------------------------------
// CONTRACT LOGIC
// ----------------------------------------------------------------------------

/// Validates the terms and writes a fresh vault for (user, merchant), emitting
/// `vault_created` (or `trial_vault_created`) and extending storage TTLs.
/// Shared by the handshake entrypoints so every path behaves identically.
fn write_vault(
    env: &Env,
    user: &Address,
    merchant: &Address,
    token: &Address,
    amount_per_interval: i128,
    interval_seconds: u64,
    grace_period_seconds: u64,
    trial_end_timestamp: u64,
    setup_fee: i128,
) {
    write_vault_with_limits(
        env,
        user,
        merchant,
        token,
        amount_per_interval,
        interval_seconds,
        grace_period_seconds,
        trial_end_timestamp,
        setup_fee,
        UNLIMITED_EXPIRATION_LEDGER,
        UNLIMITED_LIFETIME_CAP,
    );
}

/// Same as `write_vault`, but with the optional #300 expiration and lifetime
/// cap. Existing creation entrypoints deliberately keep unlimited semantics.
#[allow(clippy::too_many_arguments)]
fn write_vault_with_limits(
    env: &Env,
    user: &Address,
    merchant: &Address,
    token: &Address,
    amount_per_interval: i128,
    interval_seconds: u64,
    grace_period_seconds: u64,
    trial_end_timestamp: u64,
    setup_fee: i128,
    expiration_ledger: u32,
    lifetime_cap_amount: i128,
) {
    assert!(
        amount_per_interval > 0,
        "amount_per_interval must be positive"
    );
    assert!(
        interval_seconds > 0,
        "interval_seconds must be greater than zero"
    );
    validate_vault_limits(
        env,
        expiration_ledger,
        lifetime_cap_amount,
        env.ledger().sequence(),
    );

    let key = vault_key(user, merchant);

    let vault_data = VaultData {
        token: token.clone(),
        amount_per_interval,
        interval_seconds,
        last_pull_timestamp: 0,
        grace_period_seconds,
        payment_status: PAYMENT_ACTIVE,
        initial_timestamp: env.ledger().timestamp(),
        pull_sequence: PULL_SEQUENCE_UNSET,
        is_paused: false,
        trial_end_timestamp,
        setup_fee,
        expiration_ledger,
        lifetime_cap_amount,
        total_pulled_amount: 0,
        created_ledger: env.ledger().sequence(),
        min_commitment_ledgers: 0,
        early_cancellation_fee: 0,
        settled_cycle_count: 0,
        loyalty_discount_schedule: Vec::new(env),
    };

    save_vault(env, &key, &vault_data);

    // Collect setup fee if specified (#253)
    if setup_fee > 0 {
        token::Client::new(env, token).transfer_from(
            &env.current_contract_address(),
            user,
            merchant,
            &setup_fee,
        );
    }

    // A replacement subscription resets payment policies, but retains the
    // sequential badge identity previously assigned to this subscriber.
    env.storage()
        .persistent()
        .remove(&SubscriptionKey::Swap(user.clone(), merchant.clone()));
    env.storage()
        .persistent()
        .remove(&SubscriptionKey::EscrowPolicy(
            user.clone(),
            merchant.clone(),
        ));
    clear_recovery_state(env, user, merchant);
    let tier = env
        .storage()
        .persistent()
        .get::<_, BadgeData>(&SubscriptionKey::Badge(user.clone(), merchant.clone()))
        .map(|badge| badge.tier)
        .unwrap_or(1);
    activate_badge(
        env,
        user,
        merchant,
        tier,
        env.ledger().timestamp().saturating_add(interval_seconds),
        interval_seconds,
    );

    let event = if trial_end_timestamp > 0 {
        Symbol::new(env, "trial_vault_created")
    } else {
        Symbol::new(env, "vault_created")
    };
    env.events().publish(
        (event, user.clone(), merchant.clone()),
        (
            token.clone(),
            amount_per_interval,
            interval_seconds,
            trial_end_timestamp,
            setup_fee,
        ),
    );
    // Extend vault storage TTL and contract instance TTL to prevent archival
    let (threshold, extend_to) = calculate_ttl_params(interval_seconds);
    env.storage()
        .persistent()
        .extend_ttl(&key, threshold, extend_to);
    env.storage().instance().extend_ttl(threshold, extend_to);
}

#[contract]
pub struct OrbitContract;

#[contractimpl]
impl OrbitContract {
    // --------------------------------------------------------------------
    // PROPORTIONAL REVENUE POOLS (#127)
    // --------------------------------------------------------------------

    /// Create an immutable-weight revenue pool. Immutability avoids retroactive
    /// dilution and keeps cumulative entitlement math auditable.
    pub fn create_revenue_pool(
        env: Env,
        owner: Address,
        pool_id: u64,
        token: Address,
        shareholders: Vec<(Address, u32)>,
    ) {
        owner.require_auth();
        assert!(!shareholders.is_empty(), "Shareholders must not be empty");
        assert!(
            shareholders.len() <= MAX_REVENUE_POOL_SHAREHOLDERS,
            "Too many shareholders"
        );

        let key = FeatureKey::RevenuePool(pool_id);
        assert!(
            !env.storage().persistent().has(&key),
            "Revenue pool already exists"
        );

        let mut total_shares = 0u32;
        for (index, entry) in shareholders.iter().enumerate() {
            assert!(entry.1 > 0, "Share weight must be positive");
            for previous_index in 0..index as u32 {
                let previous = shareholders
                    .get(previous_index)
                    .expect("Shareholder index missing");
                assert!(previous.0 != entry.0, "Duplicate shareholder");
            }
            total_shares = total_shares
                .checked_add(entry.1)
                .expect("Total shares overflow");
        }

        let state = RevenuePoolState {
            owner: owner.clone(),
            token: token.clone(),
            pool: RevenuePool {
                total_shares,
                shareholders,
                undistributed_balance: 0,
            },
            acc_per_share: 0,
            scaled_remainder: 0,
        };
        env.storage().persistent().set(&key, &state);
        extend_feature_key(&env, &key, MIN_TTL_LEDGERS as u64 * SECONDS_PER_LEDGER);
        env.events().publish(
            (Symbol::new(&env, "revenue_pool_created"), pool_id),
            (owner, token, total_shares),
        );
    }

    /// Deposit revenue and add it to the cumulative per-share accumulator. The
    /// division remainder is carried into later deposits, rather than discarded.
    pub fn deposit_to_pool(env: Env, sender: Address, pool_id: u64, token: Address, amount: i128) {
        sender.require_auth();
        assert!(amount > 0, "Deposit amount must be positive");

        let key = FeatureKey::RevenuePool(pool_id);
        let mut state: RevenuePoolState = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Revenue pool does not exist");
        assert!(state.token == token, "Wrong revenue pool token");

        let scaled = amount
            .checked_mul(REVENUE_ACC_SCALE)
            .expect("Revenue accumulator overflow")
            .checked_add(state.scaled_remainder)
            .expect("Revenue accumulator overflow");
        let total_shares = i128::from(state.pool.total_shares);
        let increment = scaled / total_shares;
        state.scaled_remainder = scaled % total_shares;
        state.acc_per_share = state
            .acc_per_share
            .checked_add(increment)
            .expect("Revenue accumulator overflow");
        state.pool.undistributed_balance = state
            .pool
            .undistributed_balance
            .checked_add(amount)
            .expect("Revenue balance overflow");

        // Effects precede the external token call; a failed transfer reverts all.
        env.storage().persistent().set(&key, &state);
        token::Client::new(&env, &token).transfer_from(
            &env.current_contract_address(),
            &sender,
            &env.current_contract_address(),
            &amount,
        );
        extend_feature_key(&env, &key, MIN_TTL_LEDGERS as u64 * SECONDS_PER_LEDGER);
        env.events().publish(
            (Symbol::new(&env, "revenue_deposited"), pool_id),
            (sender, token, amount, state.acc_per_share),
        );
    }

    /// Claim all whole-token units accrued to `shareholder` and not previously
    /// withdrawn. Fractional fixed-point entitlement remains for later deposits.
    pub fn claim_shareholder_dividends(env: Env, shareholder: Address, pool_id: u64) -> i128 {
        shareholder.require_auth();
        let pool_key = FeatureKey::RevenuePool(pool_id);
        let mut state: RevenuePoolState = env
            .storage()
            .persistent()
            .get(&pool_key)
            .expect("Revenue pool does not exist");
        let weight = i128::from(shareholder_weight(&state, &shareholder));
        let gross_entitlement = weight
            .checked_mul(state.acc_per_share)
            .expect("Dividend entitlement overflow")
            / REVENUE_ACC_SCALE;

        let account_key = FeatureKey::RevenueAccount(pool_id, shareholder.clone());
        let mut account: RevenueAccount = env
            .storage()
            .persistent()
            .get(&account_key)
            .unwrap_or(RevenueAccount { claimed: 0 });
        let amount = gross_entitlement
            .checked_sub(account.claimed)
            .expect("Invalid dividend account");
        assert!(amount > 0, "No dividends available");
        assert!(
            amount <= state.pool.undistributed_balance,
            "Insufficient pool balance"
        );

        account.claimed = gross_entitlement;
        state.pool.undistributed_balance -= amount;
        env.storage().persistent().set(&account_key, &account);
        env.storage().persistent().set(&pool_key, &state);
        token::Client::new(&env, &state.token).transfer(
            &env.current_contract_address(),
            &shareholder,
            &amount,
        );
        extend_feature_key(&env, &pool_key, MIN_TTL_LEDGERS as u64 * SECONDS_PER_LEDGER);
        extend_feature_key(
            &env,
            &account_key,
            MIN_TTL_LEDGERS as u64 * SECONDS_PER_LEDGER,
        );
        env.events().publish(
            (Symbol::new(&env, "revenue_claimed"), pool_id),
            (shareholder, amount),
        );
        amount
    }

    pub fn get_revenue_pool(env: Env, pool_id: u64) -> Option<RevenuePoolState> {
        env.storage()
            .persistent()
            .get(&FeatureKey::RevenuePool(pool_id))
    }

    // --------------------------------------------------------------------
    // MERCHANT-FUNDED SPONSOR REIMBURSEMENT (#130)
    // --------------------------------------------------------------------

    /// Configure a reimbursement reserve. The merchant must provide the
    /// canonical native-XLM SAC address for the deployment network and a
    /// trusted off-chain transaction sponsor.
    pub fn configure_gas_subsidy(
        env: Env,
        merchant: Address,
        native_token: Address,
        sponsor: Address,
        max_subsidy_per_handshake: i128,
    ) {
        merchant.require_auth();
        assert!(
            max_subsidy_per_handshake > 0,
            "Maximum subsidy must be positive"
        );
        let key = FeatureKey::GasSubsidy(merchant.clone());
        let pool = if let Some(existing) = env.storage().persistent().get::<_, GasSubsidyPool>(&key)
        {
            assert!(!existing.locked, "Gas subsidy pool is locked");
            assert!(
                existing.native_token == native_token,
                "Cannot change funded subsidy token"
            );
            assert!(
                existing.sponsor == sponsor,
                "Cannot change configured sponsor"
            );
            GasSubsidyPool {
                max_subsidy_per_handshake,
                ..existing
            }
        } else {
            GasSubsidyPool {
                native_token,
                sponsor,
                balance: 0,
                max_subsidy_per_handshake,
                next_nonce: 0,
                locked: false,
            }
        };
        env.storage().persistent().set(&key, &pool);
        extend_feature_key(&env, &key, MIN_TTL_LEDGERS as u64 * SECONDS_PER_LEDGER);
    }

    pub fn deposit_gas_subsidy(env: Env, merchant: Address, amount: i128) {
        merchant.require_auth();
        assert!(amount > 0, "Subsidy deposit must be positive");
        let key = FeatureKey::GasSubsidy(merchant.clone());
        let mut pool: GasSubsidyPool = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Gas subsidy pool is not configured");
        assert!(!pool.locked, "Gas subsidy pool is locked");
        pool.balance = pool
            .balance
            .checked_add(amount)
            .expect("Gas subsidy balance overflow");
        pool.locked = true;
        env.storage().persistent().set(&key, &pool);
        token::Client::new(&env, &pool.native_token).transfer_from(
            &env.current_contract_address(),
            &merchant,
            &env.current_contract_address(),
            &amount,
        );
        pool.locked = false;
        env.storage().persistent().set(&key, &pool);
        extend_feature_key(&env, &key, MIN_TTL_LEDGERS as u64 * SECONDS_PER_LEDGER);
        env.events().publish(
            (Symbol::new(&env, "gas_subsidy_deposited"), merchant),
            (amount, pool.balance),
        );
    }

    pub fn withdraw_gas_subsidy(env: Env, merchant: Address, amount: i128) {
        merchant.require_auth();
        assert!(amount > 0, "Subsidy withdrawal must be positive");
        let key = FeatureKey::GasSubsidy(merchant.clone());
        let mut pool: GasSubsidyPool = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Gas subsidy pool is not configured");
        assert!(!pool.locked, "Gas subsidy pool is locked");
        assert!(amount <= pool.balance, "Insufficient subsidy balance");
        pool.balance -= amount;
        pool.locked = true;
        env.storage().persistent().set(&key, &pool);
        token::Client::new(&env, &pool.native_token).transfer(
            &env.current_contract_address(),
            &merchant,
            &amount,
        );
        pool.locked = false;
        env.storage().persistent().set(&key, &pool);
        env.events().publish(
            (Symbol::new(&env, "gas_subsidy_withdrawn"), merchant),
            (amount, pool.balance),
        );
    }

    /// Create a vault while reimbursing a configured transaction sponsor from
    /// the merchant reserve. The sponsor must still submit/pay the transaction;
    /// Soroban contracts cannot pay their own invocation fee.
    pub fn create_sponsored_vault(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
        amount_per_interval: i128,
        interval_seconds: u64,
        subsidy_amount: i128,
        nonce: u64,
    ) {
        user.require_auth();
        assert!(subsidy_amount > 0, "Subsidy amount must be positive");
        let subsidy_key = FeatureKey::GasSubsidy(merchant.clone());
        let mut pool: GasSubsidyPool = env
            .storage()
            .persistent()
            .get(&subsidy_key)
            .expect("Gas subsidy pool is not configured");
        pool.sponsor.require_auth();
        assert!(!pool.locked, "Gas subsidy pool is locked");
        assert!(
            subsidy_amount <= pool.max_subsidy_per_handshake,
            "Subsidy exceeds per-handshake cap"
        );
        assert!(
            subsidy_amount <= pool.balance,
            "Insufficient subsidy balance"
        );
        assert!(nonce == pool.next_nonce, "Invalid subsidy nonce");

        pool.balance -= subsidy_amount;
        pool.next_nonce = pool
            .next_nonce
            .checked_add(1)
            .expect("Subsidy nonce exhausted");
        pool.locked = true;
        env.storage().persistent().set(&subsidy_key, &pool);

        write_vault(
            &env,
            &user,
            &merchant,
            &token,
            amount_per_interval,
            interval_seconds,
            DEFAULT_GRACE_PERIOD_SECONDS,
            0,
            0,
        );
        token::Client::new(&env, &pool.native_token).transfer(
            &env.current_contract_address(),
            &pool.sponsor,
            &subsidy_amount,
        );

        pool.locked = false;
        env.storage().persistent().set(&subsidy_key, &pool);
        env.events().publish(
            (Symbol::new(&env, "vault_sponsored"), user, merchant),
            (pool.sponsor, subsidy_amount, nonce),
        );
    }

    pub fn get_gas_subsidy_pool(env: Env, merchant: Address) -> Option<GasSubsidyPool> {
        env.storage()
            .persistent()
            .get(&FeatureKey::GasSubsidy(merchant))
    }

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
        Self::create_vault_with_grace_period(
            env,
            user,
            merchant,
            token,
            amount_per_interval,
            interval_seconds,
            DEFAULT_GRACE_PERIOD_SECONDS,
        );
    }

    pub fn create_vault_with_grace_period(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
        amount_per_interval: i128,
        interval_seconds: u64,
        grace_period_seconds: u64,
    ) {
        user.require_auth();
        assert!(
            grace_period_seconds > 0,
            "grace_period_seconds must be greater than zero"
        );

        write_vault(
            &env,
            &user,
            &merchant,
            &token,
            amount_per_interval,
            interval_seconds,
            grace_period_seconds,
            0,
            0,
        );
    }

    /// Create a vault with an optional ledger expiration and lifetime pull cap
    /// (#300). `expiration_ledger = 0` and `lifetime_cap_amount = -1` are the
    /// explicit unbounded sentinels; all other non-positive values are rejected.
    pub fn create_vault_with_limits(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
        amount_per_interval: i128,
        interval_seconds: u64,
        expiration_ledger: u32,
        lifetime_cap_amount: i128,
    ) {
        user.require_auth();
        validate_vault_limits(
            &env,
            expiration_ledger,
            lifetime_cap_amount,
            env.ledger().sequence(),
        );
        write_vault_with_limits(
            &env,
            &user,
            &merchant,
            &token,
            amount_per_interval,
            interval_seconds,
            DEFAULT_GRACE_PERIOD_SECONDS,
            0,
            0,
            expiration_ledger,
            lifetime_cap_amount,
        );
        env.events().publish(
            (Symbol::new(&env, "vault_limits_configured"), user, merchant),
            (expiration_ledger, lifetime_cap_amount),
        );
    }

    /// Update the optional limits of an existing vault. Subscriber-authorized,
    /// matching the other vault configuration entrypoints. Expired vaults are
    /// terminal and cannot be revived by raising the cap.
    pub fn configure_vault_limits(
        env: Env,
        user: Address,
        merchant: Address,
        expiration_ledger: u32,
        lifetime_cap_amount: i128,
    ) {
        user.require_auth();
        validate_vault_limits(
            &env,
            expiration_ledger,
            lifetime_cap_amount,
            env.ledger().sequence(),
        );
        let key = vault_key(&user, &merchant);
        let mut vault = load_vault(&env, &key).expect("Vault does not exist");
        if vault.payment_status == PAYMENT_EXPIRED {
            panic_with_error!(&env, OrbitContractError::VaultExpired);
        }
        if lifetime_cap_amount != UNLIMITED_LIFETIME_CAP
            && vault.total_pulled_amount > lifetime_cap_amount
        {
            panic_with_error!(&env, OrbitContractError::InvalidVaultLimit);
        }
        vault.expiration_ledger = expiration_ledger;
        vault.lifetime_cap_amount = lifetime_cap_amount;
        save_vault(&env, &key, &vault);
        env.events().publish(
            (Symbol::new(&env, "vault_limits_configured"), user, merchant),
            (expiration_ledger, lifetime_cap_amount),
        );
    }

    /// Create a vault with an upfront setup fee collected on initialization (#253)
    pub fn create_vault_with_setup_fee(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
        amount_per_interval: i128,
        interval_seconds: u64,
        setup_fee: i128,
    ) {
        user.require_auth();
        write_vault(
            &env,
            &user,
            &merchant,
            &token,
            amount_per_interval,
            interval_seconds,
            DEFAULT_GRACE_PERIOD_SECONDS,
            0,
            setup_fee,
        );
    }

    /// Create a subscription that starts with a free-trial window. Merchant
    /// pulls are blocked until `trial_end_timestamp`, and the subscriber can
    /// cancel at any point during the trial without funds being deducted.
    pub fn create_vault_with_trial(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
        amount_per_interval: i128,
        interval_seconds: u64,
        trial_duration_seconds: u64,
    ) {
        user.require_auth();
        assert!(
            trial_duration_seconds > 0,
            "trial_duration_seconds must be greater than zero"
        );

        let trial_end_timestamp = env
            .ledger()
            .timestamp()
            .checked_add(trial_duration_seconds)
            .expect("Trial end overflow");

        write_vault(
            &env,
            &user,
            &merchant,
            &token,
            amount_per_interval,
            interval_seconds,
            DEFAULT_GRACE_PERIOD_SECONDS,
            trial_end_timestamp,
            0,
        );
    }

    /// Create a vault with both trial period and setup fee (#253).
    /// Named to fit Soroban's 32-character limit on contract function names;
    /// the original `create_vault_with_trial_and_setup_fee` (37) failed to build.
    pub fn create_vault_trial_setup_fee(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
        amount_per_interval: i128,
        interval_seconds: u64,
        trial_duration_seconds: u64,
        setup_fee: i128,
    ) {
        user.require_auth();
        assert!(
            trial_duration_seconds > 0,
            "trial_duration_seconds must be greater than zero"
        );

        let trial_end_timestamp = env
            .ledger()
            .timestamp()
            .checked_add(trial_duration_seconds)
            .expect("Trial end overflow");

        write_vault(
            &env,
            &user,
            &merchant,
            &token,
            amount_per_interval,
            interval_seconds,
            DEFAULT_GRACE_PERIOD_SECONDS,
            trial_end_timestamp,
            setup_fee,
        );
    }

    /// Create a fixed-interval vault with a separately designated recovery
    /// address. Existing creation entrypoints remain recovery-disabled.
    pub fn create_vault_with_recovery(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
        amount_per_interval: i128,
        interval_seconds: u64,
        recovery_address: Address,
    ) {
        user.require_auth();
        assert!(
            recovery_address != user,
            "Recovery address must differ from user"
        );
        write_vault(
            &env,
            &user,
            &merchant,
            &token,
            amount_per_interval,
            interval_seconds,
            DEFAULT_GRACE_PERIOD_SECONDS,
            0,
            0,
        );

        let recovery_key = FeatureKey::RecoveryConfig(user.clone(), merchant.clone());
        env.storage().persistent().set(
            &recovery_key,
            &VaultRecoveryConfig {
                recovery_address: recovery_address.clone(),
            },
        );
        extend_feature_key(&env, &recovery_key, interval_seconds);
        env.events().publish(
            (Symbol::new(&env, "recovery_configured"), user, merchant),
            recovery_address,
        );
    }

    pub fn get_vault_recovery(
        env: Env,
        user: Address,
        merchant: Address,
    ) -> Option<VaultRecoveryRequest> {
        env.storage()
            .persistent()
            .get(&FeatureKey::RecoveryRequest(user, merchant))
    }

    /// The designated address starts the challenge window and immediately
    /// freezes merchant pulls so a lost-key vault cannot keep draining.
    pub fn initiate_vault_recovery(
        env: Env,
        recovery_address: Address,
        user: Address,
        merchant: Address,
    ) {
        recovery_address.require_auth();
        let config_key = FeatureKey::RecoveryConfig(user.clone(), merchant.clone());
        let config: VaultRecoveryConfig = env
            .storage()
            .persistent()
            .get(&config_key)
            .expect("Vault recovery is not configured");
        assert!(
            config.recovery_address == recovery_address,
            "Not the designated recovery address"
        );
        let request_key = FeatureKey::RecoveryRequest(user.clone(), merchant.clone());
        assert!(
            !env.storage().persistent().has(&request_key),
            "Recovery already pending"
        );

        let vault_key = vault_key(&user, &merchant);
        let mut vault = load_vault(&env, &vault_key).expect("Vault does not exist");
        let now = env.ledger().timestamp();
        let execute_after = now
            .checked_add(RECOVERY_TIMELOCK_SECONDS)
            .expect("Recovery deadline overflow");
        let request = VaultRecoveryRequest {
            recovery_address: recovery_address.clone(),
            initiated_at: now,
            execute_after,
            was_paused: vault.is_paused,
        };
        vault.is_paused = true;
        save_vault(&env, &vault_key, &vault);
        deactivate_badge(&env, &user, &merchant, vault.interval_seconds);
        env.storage().persistent().set(&request_key, &request);
        extend_feature_key(&env, &config_key, RECOVERY_TIMELOCK_SECONDS);
        extend_feature_key(&env, &request_key, RECOVERY_TIMELOCK_SECONDS);
        env.events().publish(
            (Symbol::new(&env, "recovery_initiated"), user, merchant),
            (recovery_address, execute_after),
        );
    }

    /// The original key can veto a pending request at any point before it is
    /// executed and restores the vault's prior pause state.
    pub fn cancel_recovery(env: Env, user: Address, merchant: Address) {
        user.require_auth();
        let request_key = FeatureKey::RecoveryRequest(user.clone(), merchant.clone());
        let request: VaultRecoveryRequest = env
            .storage()
            .persistent()
            .get(&request_key)
            .expect("Recovery request does not exist");
        let vault_key = vault_key(&user, &merchant);
        let mut vault = load_vault(&env, &vault_key).expect("Vault does not exist");
        vault.is_paused = request.was_paused;
        save_vault(&env, &vault_key, &vault);
        if !vault.is_paused {
            let tier = env
                .storage()
                .persistent()
                .get::<_, BadgeData>(&SubscriptionKey::Badge(user.clone(), merchant.clone()))
                .map(|badge| badge.tier)
                .unwrap_or(1);
            activate_badge(
                &env,
                &user,
                &merchant,
                tier,
                env.ledger()
                    .timestamp()
                    .saturating_add(vault.interval_seconds),
                vault.interval_seconds,
            );
        }
        env.storage().persistent().remove(&request_key);
        env.events().publish(
            (Symbol::new(&env, "recovery_cancelled"), user, merchant),
            (),
        );
    }

    /// After the challenge window, replace the old vault with a paused vault
    /// owned by the recovery address. The recovered account must approve the
    /// token allowance and call `resume_vault` before billing can restart.
    pub fn execute_vault_recovery(
        env: Env,
        recovery_address: Address,
        user: Address,
        merchant: Address,
    ) {
        recovery_address.require_auth();
        let request_key = FeatureKey::RecoveryRequest(user.clone(), merchant.clone());
        let request: VaultRecoveryRequest = env
            .storage()
            .persistent()
            .get(&request_key)
            .expect("Recovery request does not exist");
        assert!(
            request.recovery_address == recovery_address,
            "Not the designated recovery address"
        );
        assert!(
            env.ledger().timestamp() >= request.execute_after,
            "Recovery timelock has not elapsed"
        );

        let old_key = vault_key(&user, &merchant);
        let old_vault = load_vault(&env, &old_key).expect("Vault does not exist");
        let new_key = vault_key(&recovery_address, &merchant);
        assert!(
            !env.storage().persistent().has(&new_key),
            "Recovery destination vault already exists"
        );

        let now = env.ledger().timestamp();
        let replacement = VaultData {
            token: old_vault.token.clone(),
            amount_per_interval: old_vault.amount_per_interval,
            interval_seconds: old_vault.interval_seconds,
            last_pull_timestamp: now,
            grace_period_seconds: old_vault.grace_period_seconds,
            payment_status: PAYMENT_ACTIVE,
            initial_timestamp: now,
            pull_sequence: PULL_SEQUENCE_UNSET,
            is_paused: true,
            trial_end_timestamp: 0,
            setup_fee: 0,
            expiration_ledger: UNLIMITED_EXPIRATION_LEDGER,
            lifetime_cap_amount: UNLIMITED_LIFETIME_CAP,
            total_pulled_amount: 0,
            created_ledger: old_vault.created_ledger,
            min_commitment_ledgers: old_vault.min_commitment_ledgers,
            early_cancellation_fee: old_vault.early_cancellation_fee,
            settled_cycle_count: old_vault.settled_cycle_count,
            loyalty_discount_schedule: old_vault.loyalty_discount_schedule.clone(),
        };

        // Remove the old contract-level connection before creating the new one.
        deactivate_badge(&env, &user, &merchant, old_vault.interval_seconds);
        env.storage().persistent().remove(&old_key);
        env.storage()
            .persistent()
            .remove(&vault_schema_key(&old_key));
        env.storage()
            .persistent()
            .remove(&vault_billing_schema_key(&old_key));
        env.storage()
            .persistent()
            .remove(&SubscriptionKey::Swap(user.clone(), merchant.clone()));
        env.storage()
            .persistent()
            .remove(&SubscriptionKey::EscrowPolicy(
                user.clone(),
                merchant.clone(),
            ));
        clear_recovery_state(&env, &user, &merchant);

        save_vault(&env, &new_key, &replacement);
        activate_badge(
            &env,
            &recovery_address,
            &merchant,
            1,
            now.saturating_add(old_vault.interval_seconds),
            old_vault.interval_seconds,
        );
        deactivate_badge(
            &env,
            &recovery_address,
            &merchant,
            old_vault.interval_seconds,
        );
        let (threshold, extend_to) = calculate_ttl_params(old_vault.interval_seconds);
        env.storage()
            .persistent()
            .extend_ttl(&new_key, threshold, extend_to);
        env.events().publish(
            (Symbol::new(&env, "vault_recovered"), user, merchant),
            recovery_address,
        );
    }

    /// Contract-native soulbound credential: no transfer or approval method
    /// exists; third-party contracts can call this public read once per pair.
    pub fn get_subscriber_badge(env: Env, user: Address, merchant: Address) -> Option<BadgeData> {
        env.storage()
            .persistent()
            .get(&SubscriptionKey::Badge(user, merchant))
    }

    pub fn is_subscriber_active(env: Env, user: Address, merchant: Address) -> bool {
        let frozen = is_merchant_frozen(&env, &user, &merchant);
        let key = VaultKey {
            user: user.clone(),
            merchant: merchant.clone(),
        };
        let vault: Option<VaultData> = env.storage().persistent().get(&key);
        let badge: Option<BadgeData> = env
            .storage()
            .persistent()
            .get(&SubscriptionKey::Badge(user, merchant));
        match (vault, badge) {
            (Some(vault), Some(badge)) => {
                badge.active
                    && !vault.is_paused
                    && !frozen
                    && env.ledger().timestamp() < badge.expiration_timestamp
            }
            _ => false,
        }
    }

    /// Merchant-assigned tier, without allowing arbitrary minting by a user.
    pub fn set_subscriber_tier(env: Env, user: Address, merchant: Address, tier: u32) {
        merchant.require_auth();
        assert!(tier > 0, "Tier must be positive");
        let key = SubscriptionKey::Badge(user.clone(), merchant.clone());
        let mut badge: BadgeData = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Subscription badge does not exist");
        assert!(
            env.storage().persistent().has(&VaultKey { user, merchant }),
            "Vault does not exist"
        );
        badge.tier = tier;
        env.storage().persistent().set(&key, &badge);
    }

    /// Permissionless keeper hook synchronizes a time-expired credential with
    /// its packed bitmap. Validity reads also enforce expiration independently.
    pub fn mark_subscription_default(env: Env, user: Address, merchant: Address) -> bool {
        let key = SubscriptionKey::Badge(user.clone(), merchant.clone());
        if let Some(badge) = env.storage().persistent().get::<_, BadgeData>(&key) {
            if badge.active && env.ledger().timestamp() >= badge.expiration_timestamp {
                let interval = env
                    .storage()
                    .persistent()
                    .get::<_, VaultData>(&VaultKey {
                        user: user.clone(),
                        merchant: merchant.clone(),
                    })
                    .map(|v| v.interval_seconds)
                    .unwrap_or(DEFAULT_ESCROW_WINDOW_SECONDS);
                deactivate_badge(&env, &user, &merchant, interval);
                return true;
            }
        }
        false
    }

    pub fn get_subscriber_bitmap_chunk(
        env: Env,
        merchant: Address,
        chunk_index: u32,
    ) -> BytesN<32> {
        env.storage()
            .persistent()
            .get(&SubscriptionKey::Bitmap(merchant, chunk_index))
            .unwrap_or_else(|| BytesN::from_array(&env, &[0u8; 32]))
    }

    /// Configure a per-vault cross-asset exact-output Soroban AMM router.
    /// Both parties consent to the trusted router, token choice, and cap.
    pub fn configure_swap(
        env: Env,
        user: Address,
        merchant: Address,
        payment_token: Address,
        router: Address,
        max_input_amount: i128,
    ) {
        user.require_auth();
        merchant.require_auth();
        assert!(max_input_amount > 0, "Maximum input must be positive");
        let vault: VaultData = env
            .storage()
            .persistent()
            .get(&VaultKey {
                user: user.clone(),
                merchant: merchant.clone(),
            })
            .expect("Vault does not exist");
        assert!(
            payment_token != vault.token,
            "Use regular billing for same-token settlement"
        );
        let key = SubscriptionKey::Swap(user, merchant);
        env.storage().persistent().set(
            &key,
            &SwapConfig {
                payment_token,
                settlement_token: vault.token,
                router,
                max_input_amount,
            },
        );
        extend_key(&env, &key, vault.interval_seconds);
    }

    pub fn clear_swap(env: Env, user: Address, merchant: Address) {
        user.require_auth();
        env.storage()
            .persistent()
            .remove(&SubscriptionKey::Swap(user, merchant));
    }

    /// Merchant pre-approves a Soroban AMM router that subscribers may use to pay
    /// in another asset (#191). Routers that are not approved here can never back
    /// a swap subscription, so the subscriber can't pick an arbitrary router.
    pub fn approve_swap_router(env: Env, merchant: Address, router: Address) {
        merchant.require_auth();
        let key = DataKey::TrustedSwapRouter(merchant, router);
        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, MIN_TTL_LEDGERS);
    }

    /// Withdraws a merchant's approval of a swap router. Existing swap vaults that
    /// use the router stop settling through it on their next pull.
    pub fn revoke_swap_router(env: Env, merchant: Address, router: Address) {
        merchant.require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::TrustedSwapRouter(merchant, router));
    }

    /// Subscribe and set up a cross-asset payment in a single invocation (#191).
    /// The subscriber pays `payment_token`, the merchant settles in
    /// `settlement_token`, and `router` converts between them on each pull.
    ///
    /// Vault creation, the swap config, and the payment-token allowance all happen
    /// here, so one subscriber signature covers them and any failure reverts the
    /// whole call. Soroban allows one contract invocation per transaction, so
    /// this is how the subscribe-and-swap step stays atomic.
    pub fn create_vault_with_swap(
        env: Env,
        user: Address,
        merchant: Address,
        payment_token: Address,
        settlement_token: Address,
        router: Address,
        amount_per_interval: i128,
        interval_seconds: u64,
        max_input_amount: i128,
        payment_allowance: i128,
        allowance_live_until_ledger: u32,
    ) {
        user.require_auth();
        assert!(max_input_amount > 0, "Maximum input must be positive");
        assert!(
            payment_token != settlement_token,
            "Use regular billing for same-token settlement"
        );
        assert!(
            payment_allowance >= max_input_amount,
            "Allowance must cover the maximum input"
        );
        assert!(
            env.storage()
                .persistent()
                .get(&DataKey::TrustedSwapRouter(
                    merchant.clone(),
                    router.clone()
                ))
                .unwrap_or(false),
            "Router is not approved by this merchant"
        );

        // The user already authorized this entrypoint. Calling the public
        // `create_vault` entrypoint here would request the same auth frame a
        // second time and Soroban rejects that duplicate authorization.
        // Write the vault directly: `create_vault` would require `user` auth a
        // second time in this frame, which the host rejects.
        write_vault(
            &env,
            &user,
            &merchant,
            &settlement_token,
            amount_per_interval,
            interval_seconds,
            DEFAULT_GRACE_PERIOD_SECONDS,
            0,
            0,
        );

        token::Client::new(&env, &payment_token).approve(
            &user,
            &env.current_contract_address(),
            &payment_allowance,
            &allowance_live_until_ledger,
        );

        let key = SubscriptionKey::Swap(user.clone(), merchant.clone());
        env.storage().persistent().set(
            &key,
            &SwapConfig {
                payment_token: payment_token.clone(),
                settlement_token: settlement_token.clone(),
                router,
                max_input_amount,
            },
        );
        extend_key(&env, &key, interval_seconds);

        env.events().publish(
            (Symbol::new(&env, "vault_swap_configured"), user, merchant),
            (payment_token, settlement_token, max_input_amount),
        );
    }

    /// Opt into dispute-protected settlement with a pre-agreed arbitrator.
    /// Legacy vaults continue immediate settlement for backward compatibility.
    pub fn configure_escrow(
        env: Env,
        user: Address,
        merchant: Address,
        arbitrator: Address,
        escrow_window_seconds: u64,
        dispute_timeout_ledgers: u32,
    ) {
        user.require_auth();
        merchant.require_auth();
        assert!(escrow_window_seconds > 0, "Escrow window must be positive");
        assert!(
            dispute_timeout_ledgers > 0,
            "Dispute timeout must be positive"
        );
        let vault: VaultData = env
            .storage()
            .persistent()
            .get(&VaultKey {
                user: user.clone(),
                merchant: merchant.clone(),
            })
            .expect("Vault does not exist");
        let key = SubscriptionKey::EscrowPolicy(user, merchant);
        env.storage().persistent().set(
            &key,
            &EscrowPolicy {
                arbitrator,
                window_seconds: escrow_window_seconds,
                dispute_timeout_ledgers,
            },
        );
        extend_key(
            &env,
            &key,
            vault.interval_seconds.max(escrow_window_seconds),
        );
    }

    /// Subscriber-only dispute during an open claim window. A disputed hold
    /// cannot be claimed until the designated arbitrator resolves it.
    pub fn raise_dispute(env: Env, user: Address, merchant: Address, pull_id: u64) {
        user.require_auth();
        let key = SubscriptionKey::Escrow(pull_id);
        let mut hold: EscrowHold = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Escrow does not exist");
        assert!(
            hold.user == user && hold.merchant == merchant,
            "Wrong escrow parties"
        );
        assert!(
            env.ledger().timestamp() < hold.release_at,
            "Dispute window closed"
        );
        assert!(!hold.disputed, "Already disputed");
        hold.disputed = true;
        hold.dispute_started_ledger = env.ledger().sequence();
        env.storage().persistent().set(&key, &hold);
    }

    /// The escrow's designated arbitrator is the only entity authorized to
    /// apportion funds. Percentages outside 0–100 are rejected. Renamed from
    /// `resolve_dispute` so the #225 milestone resolver can own that name.
    pub fn resolve_pull_dispute(
        env: Env,
        arbitrator: Address,
        pull_id: u64,
        refund_percentage: u32,
    ) {
        arbitrator.require_auth();
        assert!(refund_percentage <= 100, "Invalid refund percentage");
        let key = SubscriptionKey::Escrow(pull_id);
        let hold: EscrowHold = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Escrow does not exist");
        assert!(hold.disputed, "Escrow is not disputed");
        assert!(hold.arbitrator == arbitrator, "Unauthorized arbitrator");
        assert!(
            env.ledger()
                .sequence()
                .saturating_sub(hold.dispute_started_ledger)
                < hold.dispute_timeout_ledgers,
            "Dispute timeout elapsed"
        );
        env.storage().persistent().remove(&key);
        let refund = (hold.amount / 100) * i128::from(refund_percentage)
            + ((hold.amount % 100) * i128::from(refund_percentage) / 100);
        let contract = env.current_contract_address();
        let token = token::Client::new(&env, &hold.token);
        if refund > 0 {
            token.transfer(&contract, &hold.user, &refund);
        }
        if hold.amount > refund {
            token.transfer(&contract, &hold.merchant, &(hold.amount - refund));
        }
    }

    pub fn claim_escrow_funds(env: Env, merchant: Address, pull_id: u64) {
        merchant.require_auth();
        let key = SubscriptionKey::Escrow(pull_id);
        let hold: EscrowHold = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Escrow does not exist");
        assert!(hold.merchant == merchant, "Wrong escrow merchant");
        assert!(!hold.disputed, "Escrow disputed");
        assert!(
            env.ledger().timestamp() >= hold.release_at,
            "Escrow window still open"
        );
        env.storage().persistent().remove(&key);
        token::Client::new(&env, &hold.token).transfer(
            &env.current_contract_address(),
            &merchant,
            &hold.amount,
        );
    }

    /// Claims an active dispute after its configured ledger timeout. The
    /// depositor may request an automatic refund, or the merchant may claim
    /// the full balance as the default settlement fallback.
    pub fn claim_expired_dispute(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();
        let key = SubscriptionKey::Escrow(escrow_id);
        let hold: EscrowHold = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Escrow does not exist");
        assert!(hold.disputed, "Escrow is not disputed");
        assert!(
            hold.user == caller || hold.merchant == caller,
            "Unauthorized escrow claimant"
        );
        let elapsed = env
            .ledger()
            .sequence()
            .saturating_sub(hold.dispute_started_ledger);
        assert!(
            elapsed >= hold.dispute_timeout_ledgers,
            "Dispute timeout has not elapsed"
        );

        env.storage().persistent().remove(&key);
        let contract = env.current_contract_address();
        let token = token::Client::new(&env, &hold.token);
        token.transfer(&contract, &caller, &hold.amount);
        env.events().publish(
            (Symbol::new(&env, "esc_tout"), escrow_id, caller),
            hold.amount,
        );
    }

    pub fn get_escrow(env: Env, pull_id: u64) -> Option<EscrowHold> {
        env.storage()
            .persistent()
            .get(&SubscriptionKey::Escrow(pull_id))
    }

    /// Read the current terms for a user/merchant vault.
    /// This entrypoint requires no authorization and does not modify storage.
    pub fn get_vault(env: Env, user: Address, merchant: Address) -> Option<VaultData> {
        load_vault(&env, &vault_key(&user, &merchant))
    }

    /// Read one subscriber's vaults with several merchants in a single call
    /// (#362). Entry `i` is the vault for `merchants[i]`, or `None` when it does
    /// not exist. Read-only: no authorization, no storage writes, no events.
    pub fn get_vaults_batch(
        env: Env,
        user: Address,
        merchants: Vec<Address>,
    ) -> Vec<Option<VaultData>> {
        assert!(
            merchants.len() <= MAX_BATCH_VAULT_QUERY,
            "batch size exceeds MAX_BATCH_VAULT_QUERY"
        );
        let mut vaults = Vec::new(&env);
        for merchant in merchants.iter() {
            let key = VaultKey {
                user: user.clone(),
                merchant,
            };
            vaults.push_back(load_vault(&env, &key));
        }
        vaults
    }

    /// Read a merchant's vaults with several subscribers in a single call
    /// (#362). Entry `i` is the vault for `users[i]`, or `None` when it does not
    /// exist. Read-only: no authorization, no storage writes, no events.
    pub fn get_merchant_vaults_batch(
        env: Env,
        merchant: Address,
        users: Vec<Address>,
    ) -> Vec<Option<VaultData>> {
        assert!(
            users.len() <= MAX_BATCH_VAULT_QUERY,
            "batch size exceeds MAX_BATCH_VAULT_QUERY"
        );
        let mut vaults = Vec::new(&env);
        for user in users.iter() {
            let key = VaultKey {
                user,
                merchant: merchant.clone(),
            };
            vaults.push_back(load_vault(&env, &key));
        }
        vaults
    }

    /// Close a vault so the merchant can no longer pull from it.
    /// Only the user can cancel. A mutually configured early fee is transferred
    /// before the vault is removed; the remaining token allowance is untouched.
    /// Removes the fixed-interval vault and/or the metered vault (#46) for the
    /// pair; panics if neither exists.
    pub fn cancel_vault(env: Env, user: Address, merchant: Address) {
        user.require_auth();
        remove_vault(&env, &user, &merchant);
    }

    /// Prune inactive or expired vault from persistent contract storage (#336).
    /// Allowed only if vault status is Cancelled or if expiration_ledger has
    /// elapsed by more than 172,800 ledgers (~10 days) with zero remaining allowance.
    pub fn prune_vault(env: Env, user: Address, merchant: Address, caller: Address) {
        caller.require_auth();
        let key = vault_key(&user, &merchant);
        let vault = load_vault(&env, &key).expect("Vault does not exist");

        let is_cancelled = vault.payment_status == PAYMENT_CANCELLED;
        let seq = env.ledger().sequence();
        let is_expired_and_exhausted = if vault.expiration_ledger != UNLIMITED_EXPIRATION_LEDGER
            && seq > vault.expiration_ledger.saturating_add(PRUNE_EXPIRATION_THRESHOLD_LEDGERS)
        {
            let zero_cap = vault.lifetime_cap_amount != UNLIMITED_LIFETIME_CAP
                && vault.total_pulled_amount >= vault.lifetime_cap_amount;
            let zero_sac = token::Client::new(&env, &vault.token)
                .allowance(&user, &env.current_contract_address())
                <= 0;
            zero_cap || zero_sac
        } else {
            false
        };

        assert!(
            is_cancelled || is_expired_and_exhausted,
            "Vault does not meet pruning criteria"
        );

        env.storage().persistent().remove(&key);
        env.storage().persistent().remove(&vault_schema_key(&key));
        env.storage()
            .persistent()
            .remove(&vault_billing_schema_key(&key));
        env.storage()
            .persistent()
            .remove(&SubscriptionKey::Swap(user.clone(), merchant.clone()));
        env.storage()
            .persistent()
            .remove(&SubscriptionKey::EscrowPolicy(
                user.clone(),
                merchant.clone(),
            ));
        clear_recovery_state(&env, &user, &merchant);

        env.events()
            .publish((symbol_short!("pruned"), user, merchant), ());
    }

    /// Configure mutually agreed early-cancellation terms for an existing vault.
    pub fn configure_cancellation_terms(
        env: Env,
        user: Address,
        merchant: Address,
        min_commitment_ledgers: u64,
        early_cancellation_fee: i128,
    ) {
        user.require_auth();
        merchant.require_auth();
        assert!(early_cancellation_fee >= 0, "Cancellation fee cannot be negative");
        let key = vault_key(&user, &merchant);
        let mut vault = load_vault(&env, &key).expect("Vault does not exist");
        vault.min_commitment_ledgers = min_commitment_ledgers;
        vault.early_cancellation_fee = early_cancellation_fee;
        save_vault(&env, &key, &vault);
        env.events().publish(
            (
                Symbol::new(&env, "cancel_terms_set"),
                user,
                merchant,
            ),
            (min_commitment_ledgers, early_cancellation_fee),
        );
    }

    /// Set progressive recurring discounts for a subscriber's existing vault.
    pub fn configure_vault_loyalty_schedule(
        env: Env,
        user: Address,
        merchant: Address,
        tiers: Vec<LoyaltyDiscountTier>,
    ) {
        merchant.require_auth();
        assert!(tiers.len() <= MAX_LOYALTY_TIERS, "Too many loyalty tiers");
        let mut previous_cycle = 0u32;
        let mut previous_discount = 0u32;
        for tier in tiers.iter() {
            assert!(tier.cycle_count > previous_cycle, "Loyalty cycle thresholds must increase");
            assert!(
                tier.discount_bps > 0 && tier.discount_bps < BPS_DENOMINATOR as u32,
                "Loyalty discount must be between 1 and 9999 basis points"
            );
            assert!(
                tier.discount_bps >= previous_discount,
                "Loyalty discounts must not decrease"
            );
            previous_cycle = tier.cycle_count;
            previous_discount = tier.discount_bps;
        }
        let key = vault_key(&user, &merchant);
        let mut vault = load_vault(&env, &key).expect("Vault does not exist");
        vault.loyalty_discount_schedule = tiers.clone();
        save_vault(&env, &key, &vault);
        env.events().publish(
            (
                Symbol::new(&env, "loyalty_schedule_set"),
                user,
                merchant,
            ),
            tiers.len(),
        );
    }

    pub fn merchant_cancel_vault(env: Env, merchant: Address, user: Address) {
        merchant.require_auth();
        let key = VaultKey {
            user: user.clone(),
            merchant: merchant.clone(),
        };
        assert!(env.storage().persistent().has(&key), "Vault does not exist");
        env.storage().persistent().remove(&key);
        env.storage()
            .persistent()
            .remove(&vault_schema_key(&key));
        env.storage()
            .persistent()
            .remove(&vault_billing_schema_key(&key));
        clear_recovery_state(&env, &user, &merchant);
        env.events().publish(
            (
                Symbol::new(&env, "merchant_vault_cancelled"),
                user,
                merchant,
            ),
            (),
        );
    }

    pub fn refund_subscriber(
        env: Env,
        merchant: Address,
        user: Address,
        token: Address,
        refund_amount: i128,
    ) {
        merchant.require_auth();
        assert!(refund_amount > 0, "refund_amount must be positive");
        token::Client::new(&env, &token).transfer_from(
            &env.current_contract_address(),
            &merchant,
            &user,
            &refund_amount,
        );
        env.events().publish(
            (Symbol::new(&env, "subscriber_refunded"), merchant, user),
            (token, refund_amount),
        );
    }

    pub fn record_failed_pull(env: Env, merchant: Address, user: Address) {
        merchant.require_auth();
        let key = vault_key(&user, &merchant);
        let mut vault = load_vault(&env, &key).expect("Vault does not exist");
        let current_time = env.ledger().timestamp();
        let due_date = vault
            .last_pull_timestamp
            .checked_add(vault.interval_seconds)
            .expect("Due date overflow");

        if vault.payment_status == PAYMENT_DEFAULTED || vault.payment_status == PAYMENT_EXPIRED {
            return;
        }
        if current_time > due_date {
            let grace_end = due_date
                .checked_add(vault.grace_period_seconds)
                .expect("Grace period overflow");
            vault.payment_status = if current_time >= grace_end {
                PAYMENT_DEFAULTED
            } else {
                PAYMENT_GRACE_PERIOD
            };
            save_vault(&env, &key, &vault);
            env.events().publish(
                (Symbol::new(&env, "payment_status_updated"), user, merchant),
                (vault.payment_status, current_time),
            );
        }
    }

    pub fn pause_vault(env: Env, user: Address, merchant: Address) {
        user.require_auth();

        let key = vault_key(&user, &merchant);
        let mut vault = load_vault(&env, &key).expect("Vault does not exist");
        vault.is_paused = true;
        save_vault(&env, &key, &vault);

        env.events()
            .publish((Symbol::new(&env, "vault_paused"), user, merchant), ());

        let (threshold, extend_to) = calculate_ttl_params(vault.interval_seconds);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold, extend_to);
        env.storage().instance().extend_ttl(threshold, extend_to);
    }

    pub fn update_vault_terms(
        env: Env,
        user: Address,
        merchant: Address,
        new_amount: i128,
        new_interval_seconds: u64,
    ) {
        user.require_auth();
        assert!(new_amount > 0, "new_amount must be positive");
        assert!(
            new_interval_seconds > 0,
            "new_interval_seconds must be greater than zero"
        );

        let key = vault_key(&user, &merchant);
        let mut vault = load_vault(&env, &key).expect("Vault does not exist");
        vault.amount_per_interval = new_amount;
        vault.interval_seconds = new_interval_seconds;
        save_vault(&env, &key, &vault);

        env.events().publish(
            (Symbol::new(&env, "vault_terms_updated"), user, merchant),
            (new_amount, new_interval_seconds),
        );

        let (threshold, extend_to) = calculate_ttl_params(new_interval_seconds);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold, extend_to);
        env.storage().instance().extend_ttl(threshold, extend_to);
    }

    /// Issue #269: Gas-efficient subscription tier migration with dual authorization.
    ///
    /// Updates a vault's amount and interval in a single transaction instead of
    /// cancel + recreate, preserving subscriber longevity metrics and halving fees.
    /// Requires both user and merchant authorization to prevent unilateral rate hikes.
    /// Aligns `last_pull_timestamp` to the current ledger so the new cycle starts
    /// cleanly without retroactive back-billing.
    pub fn update_vault(
        env: Env,
        user: Address,
        merchant: Address,
        new_amount: i128,
        new_interval_ledgers: u64,
    ) {
        // Dual authorization: both parties must consent to the new terms
        user.require_auth();
        merchant.require_auth();

        assert!(new_amount > 0, "new_amount must be positive");
        assert!(
            new_interval_ledgers > 0,
            "new_interval_ledgers must be greater than zero"
        );

        let key = vault_key(&user, &merchant);
        let mut vault = load_vault(&env, &key).expect("Vault does not exist");

        // Preserve existing vault history — only update the terms
        vault.amount_per_interval = new_amount;
        // Convert ledger count to seconds for storage consistency
        vault.interval_seconds = new_interval_ledgers.saturating_mul(SECONDS_PER_LEDGER);

        // Proration / Reset Alignment: reset the billing cycle to now so the
        // new interval starts cleanly and elapsed time isn't back-billed
        vault.last_pull_timestamp = env.ledger().timestamp();

        save_vault(&env, &key, &vault);

        // Event Emission: emit update event for backend indexers
        env.events().publish(
            (soroban_sdk::symbol_short!("v_upd"), &user, &merchant),
            (new_amount, new_interval_ledgers),
        );

        // Extend storage TTL for the new interval
        let (threshold, extend_to) = calculate_ttl_params(vault.interval_seconds);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold, extend_to);
        env.storage().instance().extend_ttl(threshold, extend_to);
    }

    /// Unfreeze a vault. The billing timestamp is reset to the current ledger
    /// timestamp so intervals that elapsed while paused are not back-billed
    /// retroactively (#93).
    pub fn resume_vault(env: Env, user: Address, merchant: Address) {
        user.require_auth();

        let key = vault_key(&user, &merchant);
        let mut vault = load_vault(&env, &key).expect("Vault does not exist");
        vault.is_paused = false;
        vault.last_pull_timestamp = env.ledger().timestamp();
        save_vault(&env, &key, &vault);

        let tier = env
            .storage()
            .persistent()
            .get::<_, BadgeData>(&SubscriptionKey::Badge(user.clone(), merchant.clone()))
            .map(|b| b.tier)
            .unwrap_or(1);
        activate_badge(
            &env,
            &user,
            &merchant,
            tier,
            env.ledger()
                .timestamp()
                .saturating_add(vault.interval_seconds),
            vault.interval_seconds,
        );

        env.events()
            .publish((Symbol::new(&env, "vault_resumed"), user, merchant), ());

        let (threshold, extend_to) = calculate_ttl_params(vault.interval_seconds);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold, extend_to);
        env.storage().instance().extend_ttl(threshold, extend_to);
    }

    /// #353: merchant freezes many subscriber vaults in one transaction, e.g.
    /// during an outage or a suspected breach. The merchant authorizes the whole
    /// batch once. Pulls on a frozen vault revert with `VaultPaused` until
    /// `batch_unpause_vaults` runs. Returns the number of vaults frozen.
    pub fn batch_pause_vaults(env: Env, merchant: Address, subscribers: Vec<Address>) -> u32 {
        merchant.require_auth();
        apply_merchant_freeze(&env, &merchant, &subscribers, true)
    }

    /// #353: merchant restores pull eligibility for a batch of subscriber vaults
    /// once service resumes. Does not lift a subscriber-initiated pause.
    pub fn batch_unpause_vaults(env: Env, merchant: Address, subscribers: Vec<Address>) -> u32 {
        merchant.require_auth();
        apply_merchant_freeze(&env, &merchant, &subscribers, false)
    }

    /// 2. THE PULL (Execute Billing)
    /// The merchant (or the Orbit backend) calls this to pull the funds.
    pub fn pull_funds(env: Env, user: Address, merchant: Address) {
        merchant.require_auth();
        // #223: a global emergency pause halts every pull transaction.
        assert_not_paused(&env);

        let key = vault_key(&user, &merchant);
        let mut vault = load_vault(&env, &key).expect("Vault does not exist");

        // A paused subscriber is never billed (#93); a merchant freeze blocks
        // pulls the same way (#353).
        assert_vault_not_paused(&env, &vault, &user, &merchant);

        let current_time = env.ledger().timestamp();

        // A free trial blocks all merchant pulls until it expires (#158)
        assert!(
            current_time >= vault.trial_end_timestamp,
            "Cannot pull funds during active free trial"
        );

        let due_date = vault
            .last_pull_timestamp
            .checked_add(vault.interval_seconds)
            .expect("Due date overflow");
        if vault.payment_status == PAYMENT_GRACE_PERIOD {
            let grace_end = due_date
                .checked_add(vault.grace_period_seconds)
                .expect("Grace period overflow");
            if current_time >= grace_end {
                vault.payment_status = PAYMENT_DEFAULTED;
                env.storage().persistent().set(&key, &vault);
            }
        }
        assert!(
            vault.payment_status != PAYMENT_DEFAULTED,
            "Vault is defaulted"
        );
        // #300: an expired vault (ledger sequence or terminal status) can never
        // pull again, even if a later retry arrives within the billing interval.
        if vault_is_expired(&env, &vault) {
            panic_with_error!(&env, OrbitContractError::VaultExpired);
        }

        if vault.last_pull_timestamp != 0 {
            assert!(
                current_time >= vault.last_pull_timestamp + vault.interval_seconds,
                "Too early to pull funds"
            );
        }

        // Deterministic epoch guard (#94): every settlement must advance the
        // billing cycle index, so no two pulls can ever land in the same cycle
        // regardless of ledger clock adjustments or retry races.
        let cycle_index =
            current_time.saturating_sub(vault.initial_timestamp) / vault.interval_seconds;
        assert!(
            vault.pull_sequence == PULL_SEQUENCE_UNSET || cycle_index > vault.pull_sequence,
            "Pull already settled in this billing cycle"
        );

        // A successful pull advances the count by exactly one, independent of
        // skipped calendar cycles.
        let next_settled_cycle_count = vault
            .settled_cycle_count
            .checked_add(1)
            .expect("Settled cycle count overflow");

        // Apply the stronger of the existing stake-based discount and the
        // per-vault recurring-cycle discount.
        let base_amount = vault.amount_per_interval;
        let mut discount_bps = loyalty_discount_bps(&env, &user, &merchant);
        for tier in vault.loyalty_discount_schedule.iter() {
            if vault.settled_cycle_count >= tier.cycle_count {
                discount_bps = discount_bps.max(tier.discount_bps);
            }
        }
        let pull_amount = if discount_bps > 0 {
            let settled = base_amount - base_amount * i128::from(discount_bps) / BPS_DENOMINATOR;
            assert!(settled > 0, "Loyalty discount would zero out the payment");
            settled
        } else {
            base_amount
        };
        // Check the actual settled amount, so a discounted pull cannot bypass
        // the cap, and reject the whole request rather than partially paying.
        if let Some(remaining) = remaining_vault_cap(&vault) {
            if pull_amount > remaining {
                panic_with_error!(&env, OrbitContractError::LifetimeCapExceeded);
            }
        }
        // #226: charge the settled amount against the vault's rolling window
        // before any token moves. Expired windows reset capacity here.
        consume_rate_limit(&env, &user, &merchant, pull_amount);
        if discount_bps > 0 {
            vault.amount_per_interval = pull_amount;
            env.events().publish(
                (
                    Symbol::new(&env, "loyalty_discount_applied"),
                    user.clone(),
                    merchant.clone(),
                ),
                (discount_bps, pull_amount),
            );
        }

        let policy_key = SubscriptionKey::EscrowPolicy(user.clone(), merchant.clone());
        let policy: Option<EscrowPolicy> = env.storage().persistent().get(&policy_key);
        if policy.is_some() {
            pull_payment(
                &env,
                &user,
                &merchant,
                &vault,
                &env.current_contract_address(),
            );
        } else {
            // #363: pays the merchant, or its co-founders per the revenue split.
            settle_pull(&env, &user, &merchant, &vault);
        }
        if let Some(policy) = policy {
            let pull_id = store_escrow(&env, &user, &merchant, &vault, &policy);
            extend_key(
                &env,
                &policy_key,
                vault.interval_seconds.max(policy.window_seconds),
            );
            env.events().publish(
                (Symbol::new(&env, "escrow_held"), pull_id),
                (user.clone(), merchant.clone(), vault.amount_per_interval),
            );
        }

        let tier = env
            .storage()
            .persistent()
            .get::<_, BadgeData>(&SubscriptionKey::Badge(user.clone(), merchant.clone()))
            .map(|b| b.tier)
            .unwrap_or(1);
        activate_badge(
            &env,
            &user,
            &merchant,
            tier,
            current_time.saturating_add(vault.interval_seconds),
            vault.interval_seconds,
        );

        vault.last_pull_timestamp = current_time;
        vault.payment_status = PAYMENT_ACTIVE;
        vault.pull_sequence = cycle_index;
        vault.settled_cycle_count = next_settled_cycle_count;
        // Cumulative accounting uses the amount actually transferred (#300).
        vault.total_pulled_amount = vault
            .total_pulled_amount
            .checked_add(pull_amount)
            .expect("Lifetime pull total overflow");
        let cap_reached = remaining_vault_cap(&vault) == Some(0);
        let expiration_reached = vault.expiration_ledger != UNLIMITED_EXPIRATION_LEDGER
            && env.ledger().sequence() >= vault.expiration_ledger;
        // Persist the full recurring charge; only this settlement was discounted.
        vault.amount_per_interval = base_amount;
        for tier in vault.loyalty_discount_schedule.iter() {
            if tier.cycle_count == next_settled_cycle_count {
                env.events().publish(
                    (
                        Symbol::new(&env, "loyalty_milestone"),
                        user.clone(),
                        merchant.clone(),
                    ),
                    (tier.cycle_count, tier.discount_bps),
                );
            }
        }
        let amount_per_interval = vault.amount_per_interval;
        let interval_seconds = vault.interval_seconds;
        save_vault(&env, &key, &vault);
        if cap_reached || expiration_reached {
            mark_vault_expired(&env, &key, &vault);
        }

        // Emit contract event
        env.events().publish(
            (Symbol::new(&env, "funds_pulled"), user, merchant),
            (amount_per_interval, current_time),
        );
        // Extend TTL on each pull for both the vault entry and the contract instance
        let (threshold, extend_to) = calculate_ttl_params(interval_seconds);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold, extend_to);
        env.storage().instance().extend_ttl(threshold, extend_to);
    }

    // --------------------------------------------------------------------
    // REVENUE SPLITS (#363)
    // --------------------------------------------------------------------

    /// Split this merchant's non-escrow pull settlements between co-founders.
    /// `splits` must hold 1 to `MAX_REVENUE_SPLITS` distinct recipients whose
    /// basis points sum to exactly 10,000; otherwise the call reverts with
    /// `RevenueSplitBpsMismatch` or `InvalidRevenueSplit`. Replaces any
    /// previous config.
    pub fn set_revenue_splits(env: Env, merchant: Address, splits: Vec<RevenueSplit>) {
        merchant.require_auth();
        validate_revenue_splits(&env, &splits);
        let key = SubscriptionKey::RevenueSplits(merchant.clone());
        env.storage().persistent().set(&key, &splits);
        extend_key(&env, &key, REVENUE_SPLIT_TTL_SECONDS);
        env.events()
            .publish((Symbol::new(&env, "revenue_splits_set"), merchant), splits);
    }

    /// Remove the split config so pulls settle 100% to the merchant again.
    pub fn clear_revenue_splits(env: Env, merchant: Address) {
        merchant.require_auth();
        env.storage()
            .persistent()
            .remove(&SubscriptionKey::RevenueSplits(merchant.clone()));
        env.events()
            .publish((Symbol::new(&env, "revenue_splits_cleared"), merchant), ());
    }

    /// The merchant's revenue split config; empty when pulls settle to the
    /// merchant alone.
    pub fn get_revenue_splits(env: Env, merchant: Address) -> Vec<RevenueSplit> {
        env.storage()
            .persistent()
            .get(&SubscriptionKey::RevenueSplits(merchant))
            .unwrap_or_else(|| Vec::new(&env))
    }

    // --------------------------------------------------------------------
    // BATCH PULL (#92)
    // --------------------------------------------------------------------

    /// Settle many due subscribers in one transaction. Instead of submitting a
    /// separate `pull_funds` transaction per subscriber (which bloats ledger fees
    /// and contends on the merchant sequence number), the merchant authorizes one
    /// call and receives one `BatchPullResult` per subscriber.
    ///
    /// Fault tolerance: each subscriber is attempted independently. A subscriber
    /// that is ineligible (missing/paused/defaulted vault, interval not elapsed,
    /// cycle already settled) or underfunded is recorded with `success == false`
    /// instead of reverting the transfers that already settled earlier in the same
    /// batch.
    pub fn batch_pull_funds(
        env: Env,
        merchant: Address,
        subscribers: Vec<Address>,
    ) -> Vec<BatchPullResult> {
        // The merchant (or the Orbit backend acting for it) authorizes the batch.
        merchant.require_auth();

        assert!(!subscribers.is_empty(), "subscribers must not be empty");
        assert!(
            subscribers.len() <= MAX_BATCH_PULL_SUBSCRIBERS,
            "batch size exceeds MAX_BATCH_PULL_SUBSCRIBERS"
        );

        let mut results = Vec::new(&env);
        let mut success_count: u32 = 0;
        let mut total_amount: i128 = 0;

        for subscriber in subscribers.iter() {
            let result = Self::try_batch_pull_subscriber(&env, &subscriber, &merchant);
            if result.success {
                success_count += 1;
                total_amount = total_amount.saturating_add(result.amount);
            }
            results.push_back(result);
        }

        // One aggregate event per batch: (merchant, success_count, total_amount).
        env.events().publish(
            (Symbol::new(&env, "batch_funds_pulled"), merchant.clone()),
            (success_count, total_amount),
        );

        results
    }

    /// Executes a single guarded pull for `(subscriber, merchant)` and reports the
    /// outcome. Returns a failing `BatchPullResult` (never panics) for any expected
    /// per-subscriber failure so the enclosing batch keeps settling.
    fn try_batch_pull_subscriber(
        env: &Env,
        subscriber: &Address,
        merchant: &Address,
    ) -> BatchPullResult {
        let skipped = |amount: i128| BatchPullResult {
            subscriber: subscriber.clone(),
            success: false,
            amount,
        };

        let key = vault_key(subscriber, merchant);
        let mut vault = match load_vault(env, &key) {
            Some(vault) => vault,
            None => return skipped(0),
        };

        // A paused subscriber is never billed (#93), and neither is a vault the
        // merchant has frozen (#353).
        if vault.is_paused || is_merchant_frozen(env, subscriber, merchant) {
            return skipped(0);
        }
        if vault.payment_status == PAYMENT_DEFAULTED || vault_is_expired(env, &vault) {
            return skipped(0);
        }

        let current_time = env.ledger().timestamp();
        if vault.last_pull_timestamp != 0
            && current_time < vault.last_pull_timestamp + vault.interval_seconds
        {
            return skipped(0);
        }

        // Deterministic epoch guard (#94): never settle the same billing cycle twice.
        let cycle_index =
            current_time.saturating_sub(vault.initial_timestamp) / vault.interval_seconds;
        if vault.pull_sequence != PULL_SEQUENCE_UNSET && cycle_index <= vault.pull_sequence {
            return skipped(0);
        }

        let next_settled_cycle_count = match vault.settled_cycle_count.checked_add(1) {
            Some(count) => count,
            None => return skipped(0),
        };
        let mut discount_bps = loyalty_discount_bps(env, subscriber, merchant);
        for tier in vault.loyalty_discount_schedule.iter() {
            if vault.settled_cycle_count >= tier.cycle_count {
                discount_bps = discount_bps.max(tier.discount_bps);
            }
        }
        let base_amount = vault.amount_per_interval;
        let amount = if discount_bps > 0 {
            base_amount - base_amount * i128::from(discount_bps) / BPS_DENOMINATOR
        } else {
            base_amount
        };
        if amount <= 0 {
            return skipped(0);
        }

        // The lifetime cap is a hard per-subscriber guard (#300). Skipping keeps
        // the fault-tolerant batch semantics while preventing any over-pull.
        if let Some(remaining) = remaining_vault_cap(&vault) {
            if amount > remaining {
                return skipped(0);
            }
        }

        // Skip a subscriber whose balance cannot cover this interval instead of
        // letting token.transfer_from abort the whole batch. This is the most
        // common benign failure (a subscriber who topped up too late).
        let token_client = token::Client::new(env, &vault.token);
        if token_client.balance(subscriber) < amount {
            return skipped(0);
        }

        // Routes through the vault's configured swap router when one exists;
        // otherwise this is a direct token.transfer_from(subscriber -> merchant),
        // or one per co-founder when the merchant has revenue splits (#363).
        vault.amount_per_interval = amount;
        settle_pull(env, subscriber, merchant, &vault);

        vault.amount_per_interval = base_amount;
        let interval_seconds = vault.interval_seconds;

        vault.last_pull_timestamp = current_time;
        vault.payment_status = PAYMENT_ACTIVE;
        vault.pull_sequence = cycle_index;
        vault.settled_cycle_count = next_settled_cycle_count;
        vault.total_pulled_amount = vault
            .total_pulled_amount
            .checked_add(amount)
            .expect("Lifetime pull total overflow");
        if discount_bps > 0 {
            env.events().publish(
                (
                    Symbol::new(env, "loyalty_discount_applied"),
                    subscriber.clone(),
                    merchant.clone(),
                ),
                (discount_bps, amount),
            );
        }
        for tier in vault.loyalty_discount_schedule.iter() {
            if tier.cycle_count == next_settled_cycle_count {
                env.events().publish(
                    (
                        Symbol::new(env, "loyalty_milestone"),
                        subscriber.clone(),
                        merchant.clone(),
                    ),
                    (tier.cycle_count, tier.discount_bps),
                );
            }
        }
        let cap_reached = remaining_vault_cap(&vault) == Some(0);
        let expiration_reached = vault.expiration_ledger != UNLIMITED_EXPIRATION_LEDGER
            && env.ledger().sequence() >= vault.expiration_ledger;
        save_vault(env, &key, &vault);
        if cap_reached || expiration_reached {
            mark_vault_expired(env, &key, &vault);
        }

        let tier = env
            .storage()
            .persistent()
            .get::<_, BadgeData>(&SubscriptionKey::Badge(
                subscriber.clone(),
                merchant.clone(),
            ))
            .map(|badge| badge.tier)
            .unwrap_or(1);
        activate_badge(
            env,
            subscriber,
            merchant,
            tier,
            current_time.saturating_add(interval_seconds),
            interval_seconds,
        );

        // Keep each processed vault (and the contract instance) resident.
        let (threshold, extend_to) = calculate_ttl_params(interval_seconds);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold, extend_to);
        env.storage().instance().extend_ttl(threshold, extend_to);

        BatchPullResult {
            subscriber: subscriber.clone(),
            success: true,
            amount,
        }
    }

    // --------------------------------------------------------------------
    // METERED (USAGE-BASED) BILLING (#46)
    // --------------------------------------------------------------------

    /// Create a usage-based allowance: the merchant may pull variable amounts
    /// up to `max_amount_per_interval` in total per `interval_seconds` epoch.
    /// Re-creating replaces the terms and starts a fresh epoch.
    pub fn create_metered_vault(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
        max_amount_per_interval: i128,
        interval_seconds: u64,
    ) {
        user.require_auth();

        assert!(
            max_amount_per_interval > 0,
            "max_amount_per_interval must be positive"
        );
        assert!(
            interval_seconds > 0,
            "interval_seconds must be greater than zero"
        );

        let key = MeteredVaultKey::Vault(user.clone(), merchant.clone());
        env.storage()
            .persistent()
            .remove(&FeatureKey::Elasticity(user.clone(), merchant.clone()));
        let vault = MeteredVaultData {
            token: token.clone(),
            max_amount_per_interval,
            interval_seconds,
            current_epoch_start: env.ledger().timestamp(),
            epoch_spent: 0,
        };
        env.storage().persistent().set(&key, &vault);

        env.events().publish(
            (Symbol::new(&env, "metered_vault_created"), user, merchant),
            (token, max_amount_per_interval, interval_seconds),
        );

        let (threshold, extend_to) = calculate_ttl_params(interval_seconds);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold, extend_to);
        env.storage().instance().extend_ttl(threshold, extend_to);
    }

    /// Create a usage-based vault with an overdraft buffer capped at 20%.
    /// The existing `create_metered_vault` remains a strict, non-elastic path.
    pub fn create_elastic_metered_vault(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
        max_amount_per_interval: i128,
        interval_seconds: u64,
        overdraft_percentage: u32,
    ) {
        assert!(
            overdraft_percentage <= MAX_OVERDRAFT_PERCENTAGE,
            "Overdraft percentage exceeds 20%"
        );
        Self::create_metered_vault(
            env.clone(),
            user.clone(),
            merchant.clone(),
            token,
            max_amount_per_interval,
            interval_seconds,
        );
        let key = FeatureKey::Elasticity(user.clone(), merchant.clone());
        env.storage().persistent().set(
            &key,
            &ElasticityData {
                overdraft_percentage,
                carried_overdraft: 0,
                epoch_overdraft: 0,
            },
        );
        extend_feature_key(&env, &key, interval_seconds);
        env.events().publish(
            (Symbol::new(&env, "elasticity_configured"), user, merchant),
            overdraft_percentage,
        );
    }

    pub fn get_metered_elasticity(
        env: Env,
        user: Address,
        merchant: Address,
    ) -> Option<ElasticityData> {
        env.storage()
            .persistent()
            .get(&FeatureKey::Elasticity(user, merchant))
    }

    /// Read a metered vault. No authorization and no storage mutation.
    pub fn get_metered_vault(
        env: Env,
        user: Address,
        merchant: Address,
    ) -> Option<MeteredVaultData> {
        let key = MeteredVaultKey::Vault(user, merchant);
        env.storage().persistent().get(&key)
    }

    /// Pull a variable `amount` against the current epoch's allowance. Several
    /// partial pulls per epoch are allowed until `max_amount_per_interval` is
    /// reached; the allowance resets once `interval_seconds` has elapsed since
    /// the epoch started.
    pub fn pull_metered_funds(env: Env, user: Address, merchant: Address, amount: i128) {
        merchant.require_auth();

        assert!(amount > 0, "amount must be positive");

        let key = MeteredVaultKey::Vault(user.clone(), merchant.clone());
        let mut vault: MeteredVaultData = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Metered vault does not exist");
        let elasticity_key = FeatureKey::Elasticity(user.clone(), merchant.clone());
        let mut elasticity: Option<ElasticityData> =
            env.storage().persistent().get(&elasticity_key);

        // Epoch rollover: strict vaults reset to their baseline. Elastic vaults
        // carry only the overdraft used in the completed epoch into the next
        // epoch's adjusted baseline.
        let now = env.ledger().timestamp();
        if now
            >= vault
                .current_epoch_start
                .saturating_add(vault.interval_seconds)
        {
            if let Some(config) = elasticity.as_mut() {
                let elapsed =
                    now.saturating_sub(vault.current_epoch_start) / vault.interval_seconds;
                config.carried_overdraft = if elapsed > 1 {
                    // At least one full, zero-spend epoch followed the debt
                    // repayment epoch, so no overdraft remains outstanding.
                    0
                } else {
                    config.epoch_overdraft
                };
                config.epoch_overdraft = 0;
            }
            vault.current_epoch_start = now;
            vault.epoch_spent = 0;
        }

        let new_spent = vault
            .epoch_spent
            .checked_add(amount)
            .expect("Interval spending limit exceeded");
        if let Some(config) = elasticity.as_mut() {
            let overdraft_limit = vault
                .max_amount_per_interval
                .checked_mul(i128::from(config.overdraft_percentage))
                .expect("Overdraft limit overflow")
                / 100;
            let adjusted_baseline = vault
                .max_amount_per_interval
                .checked_sub(config.carried_overdraft)
                .expect("Invalid carried overdraft");
            let combined_cap = adjusted_baseline
                .checked_add(overdraft_limit)
                .expect("Interval spending limit overflow");
            assert!(
                new_spent <= combined_cap,
                "Interval spending limit exceeded"
            );
            config.epoch_overdraft = new_spent.saturating_sub(adjusted_baseline);
            assert!(
                config.epoch_overdraft <= overdraft_limit,
                "Overdraft limit exceeded"
            );
        } else {
            assert!(
                new_spent <= vault.max_amount_per_interval,
                "Interval spending limit exceeded"
            );
        }

        // Record the spend before moving funds (checks-effects-interactions).
        vault.epoch_spent = new_spent;
        env.storage().persistent().set(&key, &vault);
        if let Some(config) = elasticity {
            env.storage().persistent().set(&elasticity_key, &config);
            extend_feature_key(&env, &elasticity_key, vault.interval_seconds);
        }

        let token_client = token::Client::new(&env, &vault.token);
        token_client.transfer_from(&env.current_contract_address(), &user, &merchant, &amount);

        env.events().publish(
            (Symbol::new(&env, "metered_funds_pulled"), user, merchant),
            (amount, vault.epoch_spent, vault.max_amount_per_interval),
        );

        let (threshold, extend_to) = calculate_ttl_params(vault.interval_seconds);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold, extend_to);
        env.storage().instance().extend_ttl(threshold, extend_to);
    }

    pub fn create_stream(
        env: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        deposit_amount: i128,
        start_time: u64,
        stop_time: u64,
    ) -> u64 {
        sender.require_auth();
        assert!(deposit_amount > 0, "deposit_amount must be positive");
        assert!(stop_time > start_time, "stop_time must be after start_time");

        let stream_id: u64 = env
            .storage()
            .instance()
            .get(&StorageKey::NextStreamId)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&StorageKey::NextStreamId, &(stream_id + 1));

        token::Client::new(&env, &token).transfer_from(
            &env.current_contract_address(),
            &sender,
            &env.current_contract_address(),
            &deposit_amount,
        );
        let key = StreamKey { id: stream_id };
        env.storage().persistent().set(
            &key,
            &StreamData {
                sender: sender.clone(),
                recipient: recipient.clone(),
                token: token.clone(),
                deposit_amount,
                start_time,
                stop_time,
                amount_withdrawn: 0,
            },
        );
        env.events().publish(
            (Symbol::new(&env, "stream_created"), sender, recipient),
            (stream_id, deposit_amount, start_time, stop_time),
        );
        stream_id
    }

    pub fn withdraw_from_stream(env: Env, stream_id: u64, amount: i128) {
        let key = StreamKey { id: stream_id };
        let mut stream: StreamData = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Stream does not exist");
        stream.recipient.require_auth();
        assert!(amount > 0, "amount must be positive");
        let vested = Self::vested_amount(&env, &stream);
        let available = vested - stream.amount_withdrawn;
        assert!(amount <= available, "Amount exceeds vested balance");
        stream.amount_withdrawn = stream
            .amount_withdrawn
            .checked_add(amount)
            .expect("Withdrawn amount overflow");
        token::Client::new(&env, &stream.token).transfer(
            &env.current_contract_address(),
            &stream.recipient,
            &amount,
        );
        env.storage().persistent().set(&key, &stream);
    }

    pub fn cancel_stream(env: Env, stream_id: u64) {
        let key = StreamKey { id: stream_id };
        let stream: StreamData = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Stream does not exist");
        stream.sender.require_auth();
        stream.recipient.require_auth();
        let vested = Self::vested_amount(&env, &stream);
        let recipient_amount = vested - stream.amount_withdrawn;
        let sender_amount = stream.deposit_amount - vested;
        let token_client = token::Client::new(&env, &stream.token);
        if recipient_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &stream.recipient,
                &recipient_amount,
            );
        }
        if sender_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &stream.sender,
                &sender_amount,
            );
        }
        env.storage().persistent().remove(&key);
    }

    fn vested_amount(env: &Env, stream: &StreamData) -> i128 {
        let now = env.ledger().timestamp();
        if now <= stream.start_time {
            return 0;
        }
        if now >= stream.stop_time {
            return stream.deposit_amount;
        }
        let elapsed = now - stream.start_time;
        let duration = stream.stop_time - stream.start_time;
        stream
            .deposit_amount
            .checked_mul(elapsed as i128)
            .expect("Vested amount overflow")
            / duration as i128
    }

    /// 3. THE SPLIT (Batch Payroll Disbursement)
    /// The merchant uploads a CSV of contractors. This function takes that array
    /// and routes the stablecoins to everyone globally in a single transaction block.
    pub fn batch_disburse(env: Env, sender: Address, token: Address, splits: Vec<PaymentSplit>) {
        // The sender (e.g., the Agency Owner) MUST sign this transaction to approve the payroll.
        sender.require_auth();
        // #223: a global emergency pause also halts batch payroll disbursements.
        assert_not_paused(&env);

        // The sender funds both the recipient payouts and the treasury fee,
        // so allowance must cover the original (gross) batch before we split.
        verify_payroll_allowances(&env, &sender, &splits);
        // #224: net out the configured treasury fee from each split. Total
        // allowance required stays equal to the original batch amount.
        let (splits, fee_totals, fee_config) = apply_protocol_fees(&env, splits);
        let total_amount = validate_splits(&splits);
        let recipient_count = splits.len();
        let totals = payroll_totals(&env, &splits);
        disburse(&env, &sender, splits);
        if let Some(config) = fee_config {
            settle_protocol_fees(&env, &sender, &fee_totals, &config);
        }

        // Legacy aggregate event; `token` is kept for existing consumers while
        // the summary event below reports per-asset totals (#301).
        env.events().publish(
            (Symbol::new(&env, "batch_disbursed"), sender.clone()),
            (token, recipient_count, total_amount),
        );
        let mut used_tokens = Vec::new(&env);
        let mut volume_per_token = Vec::new(&env);
        for (asset, volume) in totals.iter() {
            used_tokens.push_back(asset);
            volume_per_token.push_back(volume);
        }
        env.events().publish(
            (Symbol::new(&env, "payroll_summary"), sender),
            (
                used_tokens,
                volume_per_token,
                recipient_count,
                env.ledger().sequence(),
            ),
        );
    }

    /// Delegated batch disbursement allowing relayers to submit signed disbursements
    /// on behalf of the sender. Verifies the sender's Ed25519 signature, checks nonce
    /// validity to prevent replay attacks, and enforces a deadline ledger.
    pub fn batch_disburse_delegated(
        env: Env,
        sender: Address,
        token: Address,
        nonce: u64,
        deadline_ledger: u32,
        signature: Bytes,
        public_key: Bytes,
        splits: Vec<PaymentSplit>,
    ) {
        assert!(
            env.ledger().sequence() <= deadline_ledger,
            "deadline exceeded"
        );
        let pk_n = BytesN::<32>::try_from(public_key).expect("public key must be 32 bytes");
        let sig_n = BytesN::<64>::try_from(signature).expect("signature must be 64 bytes");
        let current_nonce = load_user_nonce(&env, &sender);
        assert!(nonce == current_nonce, "invalid nonce");
        let message =
            delegated_batch_disburse_digest(&env, &sender, &token, nonce, deadline_ledger, &splits);
        env.crypto()
            .ed25519_verify(&pk_n, &Bytes::from_array(&env, &message.to_array()), &sig_n);
        bump_user_nonce(&env, &sender, current_nonce);
        Self::batch_disburse(env, sender, token, splits);
    }

    /// 4. MULTI-SIG PAYROLL: PROPOSE
    /// The sender stages a batch disbursement that only executes once
    /// `required_approvals` distinct addresses from `approvers` approve it.
    /// Returns the proposal id.
    pub fn propose_batch_disburse(
        env: Env,
        sender: Address,
        token: Address,
        splits: Vec<PaymentSplit>,
        required_approvals: u32,
        approvers: Vec<Address>,
    ) -> u64 {
        sender.require_auth();

        let total_amount = validate_splits(&splits);

        assert!(!approvers.is_empty(), "approvers must not be empty");
        assert!(
            approvers.len() <= MAX_PAYROLL_APPROVERS,
            "too many approvers"
        );
        for (i, approver) in approvers.iter().enumerate() {
            assert!(
                approvers.first_index_of(&approver) == Some(i as u32),
                "approvers must be distinct"
            );
        }
        assert!(
            required_approvals > 0 && required_approvals <= approvers.len(),
            "required_approvals must be between 1 and the number of approvers"
        );

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextProposalId)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::NextProposalId, &(id + 1));

        let proposal = PayrollProposal {
            id,
            sender: sender.clone(),
            token: token.clone(),
            splits,
            approvers,
            approvals: Vec::new(&env),
            required_approvals,
            executed: false,
        };
        save_proposal(&env, &proposal);

        env.events().publish(
            (Symbol::new(&env, "payroll_proposed"), sender, id),
            (
                token,
                required_approvals,
                proposal.approvers.len(),
                total_amount,
            ),
        );
        id
    }

    /// 5. MULTI-SIG PAYROLL: APPROVE
    /// An address from the proposal's approver list signs off on it. Each approver
    /// counts once.
    pub fn approve_payroll_proposal(env: Env, approver: Address, proposal_id: u64) {
        approver.require_auth();

        let mut proposal = load_proposal(&env, proposal_id);
        assert!(!proposal.executed, "Proposal already executed");
        assert!(
            proposal.approvers.contains(&approver),
            "Address is not an approver for this proposal"
        );
        assert!(
            !proposal.approvals.contains(&approver),
            "Approver has already approved this proposal"
        );

        proposal.approvals.push_back(approver.clone());
        save_proposal(&env, &proposal);

        env.events().publish(
            (Symbol::new(&env, "payroll_approved"), approver, proposal_id),
            (proposal.approvals.len(), proposal.required_approvals),
        );
    }

    /// 6. MULTI-SIG PAYROLL: EXECUTE
    /// Once the approval threshold is met, anyone may trigger the transfers. A proposal
    /// executes at most once.
    pub fn execute_payroll_proposal(env: Env, proposal_id: u64) {
        let mut proposal = load_proposal(&env, proposal_id);
        assert!(!proposal.executed, "Proposal already executed");
        assert!(
            proposal.approvals.len() >= proposal.required_approvals,
            "Approval threshold not met"
        );

        // Marked before transferring; a failed transfer reverts this along with everything else
        proposal.executed = true;
        save_proposal(&env, &proposal);

        let total_amount = validate_splits(&proposal.splits);
        let recipient_count = proposal.splits.len();
        let totals = payroll_totals(&env, &proposal.splits);
        verify_payroll_allowances(&env, &proposal.sender, &proposal.splits);
        disburse(&env, &proposal.sender, proposal.splits.clone());

        env.events().publish(
            (
                Symbol::new(&env, "payroll_executed"),
                proposal.sender.clone(),
                proposal_id,
            ),
            (proposal.token, recipient_count, total_amount),
        );
        let mut used_tokens = Vec::new(&env);
        let mut volume_per_token = Vec::new(&env);
        for (asset, volume) in totals.iter() {
            used_tokens.push_back(asset);
            volume_per_token.push_back(volume);
        }
        env.events().publish(
            (
                Symbol::new(&env, "payroll_summary"),
                proposal.sender,
                proposal_id,
            ),
            (used_tokens, volume_per_token, recipient_count),
        );
    }

    /// Read a payroll proposal and its approval state.
    /// This entrypoint requires no authorization and does not modify storage.
    pub fn get_payroll_proposal(env: Env, proposal_id: u64) -> Option<PayrollProposal> {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
    }

    /// Propose a batch disbursement with an explicit expiration ledger (#345).
    pub fn propose_batch_disburse_multisig(
        env: Env,
        sender: Address,
        token: Address,
        splits: Vec<PaymentSplit>,
        required_approvals: u32,
        approvers: Vec<Address>,
        expiration_ledger: u32,
    ) -> u64 {
        let id = Self::propose_batch_disburse(
            env.clone(),
            sender.clone(),
            token,
            splits,
            required_approvals,
            approvers,
        );
        let current_nonce = load_user_nonce(&env, &sender);
        env.storage()
            .persistent()
            .set(&DataKey::ProposalExpiration(id), &expiration_ledger);
        env.storage()
            .persistent()
            .set(&DataKey::ProposalNonce(id), &current_nonce);
        id
    }

    /// Off-chain signature aggregation for delegated batch payroll sign-off (#345).
    /// Allows any gas-sponsored relayer or automated bot to submit aggregated signatures.
    pub fn batch_disburse_multisig(env: Env, batch_id: u64, signatures: Vec<SignerSignature>) {
        assert_not_paused(&env);
        let mut proposal = load_proposal(&env, batch_id);
        assert!(!proposal.executed, "Proposal already executed");

        let expiration_ledger = env
            .storage()
            .persistent()
            .get(&DataKey::ProposalExpiration(batch_id))
            .unwrap_or(u32::MAX);
        assert!(
            env.ledger().sequence() <= expiration_ledger,
            "deadline exceeded"
        );

        let current_nonce = load_user_nonce(&env, &proposal.sender);
        let expected_nonce = env
            .storage()
            .persistent()
            .get(&DataKey::ProposalNonce(batch_id))
            .unwrap_or(current_nonce);
        assert!(current_nonce == expected_nonce, "invalid nonce");

        assert!(
            signatures.len() >= proposal.required_approvals,
            "insufficient signatures"
        );

        let digest = multisig_batch_disburse_digest(
            &env,
            batch_id,
            &proposal.sender,
            &proposal.token,
            &proposal.splits,
            current_nonce,
            expiration_ledger,
        );

        let mut verified_signers = Vec::new(&env);
        for sig in signatures.iter() {
            assert!(
                proposal.approvers.contains(&sig.signer),
                "signer not authorized"
            );
            assert!(
                !verified_signers.contains(&sig.signer),
                "duplicate signer"
            );
            verify_meta_signature(&env, &sig.signer, &digest, &sig.signature);
            verified_signers.push_back(sig.signer);
        }

        assert!(
            verified_signers.len() >= proposal.required_approvals,
            "insufficient valid signatures"
        );

        bump_user_nonce(&env, &proposal.sender, current_nonce);

        proposal.executed = true;
        proposal.approvals = verified_signers;
        save_proposal(&env, &proposal);

        let total_amount = validate_splits(&proposal.splits);
        let recipient_count = proposal.splits.len();
        let totals = payroll_totals(&env, &proposal.splits);
        verify_payroll_allowances(&env, &proposal.sender, &proposal.splits);
        disburse(&env, &proposal.sender, proposal.splits.clone());

        env.events().publish(
            (
                Symbol::new(&env, "payroll_executed"),
                proposal.sender.clone(),
                batch_id,
            ),
            (proposal.token.clone(), recipient_count, total_amount),
        );
        let mut used_tokens = Vec::new(&env);
        let mut volume_per_token = Vec::new(&env);
        for (asset, volume) in totals.iter() {
            used_tokens.push_back(asset);
            volume_per_token.push_back(volume);
        }
        env.events().publish(
            (
                Symbol::new(&env, "payroll_summary"),
                proposal.sender.clone(),
                batch_id,
            ),
            (used_tokens, volume_per_token, recipient_count),
        );
        env.events().publish(
            (
                Symbol::new(&env, "batch_disbursed_multisig"),
                proposal.sender,
                batch_id,
            ),
            (proposal.token, recipient_count, total_amount),
        );
    }

    // --------------------------------------------------------------------
    // COMPETITIVE PAYROLL BOUNTIES: COMMIT-REVEAL (#212)
    // --------------------------------------------------------------------

    /// Fund a single-winner bounty with tokens locked in this contract.
    /// `proof_hash` is SHA256 of the winning raw proof bytes.
    /// The deadline is a ledger sequence, not a wall-clock timestamp.
    pub fn create_bounty(
        env: Env,
        creator: Address,
        token: Address,
        amount: i128,
        proof_hash: BytesN<32>,
        expires_at_ledger: u32,
    ) -> u64 {
        creator.require_auth();
        assert!(amount > 0, "amount must be positive");
        let now = env.ledger().sequence();
        assert!(
            expires_at_ledger > now.saturating_add(BOUNTY_REVEAL_DELAY),
            "bounty must outlive the challenge period"
        );
        // Keep the deadline within a bounded storage lifetime, so expired
        // escrows can still be reclaimed without depending on archival restore.
        assert!(
            expires_at_ledger - now <= MIN_TTL_LEDGERS,
            "bounty deadline exceeds storage lifetime"
        );
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextBountyId)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::NextBountyId,
            &(id.checked_add(1).expect("bounty id overflow")),
        );
        token::Client::new(&env, &token).transfer(
            &creator,
            env.current_contract_address(),
            &amount,
        );
        let bounty = CompetitiveBounty {
            creator: creator.clone(),
            token,
            amount,
            proof_hash,
            expires_at_ledger,
            claimed_by: None,
            cancelled: false,
        };
        let key = DataKey::Bounty(id);
        env.storage().persistent().set(&key, &bounty);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, MIN_TTL_LEDGERS);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD_LEDGERS, MIN_TTL_LEDGERS);
        env.events()
            .publish((Symbol::new(&env, "bounty_created"), id), (creator, amount));
        id
    }

    /// Store an authenticated commitment. Only one outstanding commitment is
    /// permitted per claimant and bounty; this makes replay attempts explicit.
    pub fn commit_bounty_claim(
        env: Env,
        claimant: Address,
        bounty_id: u64,
        commitment_hash: BytesN<32>,
    ) {
        claimant.require_auth();
        let bounty: CompetitiveBounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect("unknown bounty");
        let now = env.ledger().sequence();
        assert!(
            !bounty.cancelled && bounty.claimed_by.is_none(),
            "bounty unavailable"
        );
        assert!(
            now.saturating_add(BOUNTY_REVEAL_DELAY) <= bounty.expires_at_ledger,
            "too late to commit"
        );
        let key = DataKey::BountyCommit(bounty_id, claimant.clone());
        assert!(
            !env.storage().persistent().has(&key),
            "commitment already exists"
        );
        env.storage().persistent().set(
            &key,
            &BountyCommitment {
                digest: commitment_hash,
                ledger: now,
            },
        );
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, MIN_TTL_LEDGERS);
        env.events()
            .publish((Symbol::new(&env, "bounty_committed"), bounty_id), claimant);
    }

    /// A reveal cannot execute until five *later* ledgers have closed.
    /// Both the claimant and the secret salt are part of the preimage.
    pub fn reveal_bounty_claim(
        env: Env,
        claimant: Address,
        bounty_id: u64,
        proof: Bytes,
        secret_salt: BytesN<32>,
    ) {
        claimant.require_auth();
        let key = DataKey::Bounty(bounty_id);
        let mut bounty: CompetitiveBounty = env
            .storage()
            .persistent()
            .get(&key)
            .expect("unknown bounty");
        assert!(
            !bounty.cancelled && bounty.claimed_by.is_none(),
            "bounty unavailable"
        );
        let now = env.ledger().sequence();
        assert!(now <= bounty.expires_at_ledger, "bounty expired");
        let claim_key = DataKey::BountyCommit(bounty_id, claimant.clone());
        let commitment: BountyCommitment = env
            .storage()
            .persistent()
            .get(&claim_key)
            .expect("claimant did not commit");
        assert!(
            now >= commitment.ledger.saturating_add(BOUNTY_REVEAL_DELAY),
            "reveal is too early"
        );
        assert_eq!(
            bounty_claim_digest(&env, &claimant, bounty_id, &proof, &secret_salt),
            commitment.digest,
            "invalid commitment preimage"
        );
        assert_eq!(
            env.crypto().sha256(&proof).to_bytes(),
            bounty.proof_hash,
            "invalid bounty solution"
        );
        // Update before calling token; failed transfers roll back storage.
        bounty.claimed_by = Some(claimant.clone());
        env.storage().persistent().set(&key, &bounty);
        env.storage().persistent().remove(&claim_key);
        token::Client::new(&env, &bounty.token).transfer(
            &env.current_contract_address(),
            &claimant,
            &bounty.amount,
        );
        env.events().publish(
            (Symbol::new(&env, "bounty_claimed"), bounty_id),
            (claimant, bounty.amount),
        );
    }

    /// Reclaim only when a bounty expires without a winner.
    pub fn reclaim_expired_bounty(env: Env, bounty_id: u64) {
        let key = DataKey::Bounty(bounty_id);
        let mut bounty: CompetitiveBounty = env
            .storage()
            .persistent()
            .get(&key)
            .expect("unknown bounty");
        bounty.creator.require_auth();
        assert!(
            env.ledger().sequence() > bounty.expires_at_ledger,
            "bounty not expired"
        );
        assert!(
            !bounty.cancelled && bounty.claimed_by.is_none(),
            "bounty unavailable"
        );
        bounty.cancelled = true;
        env.storage().persistent().set(&key, &bounty);
        token::Client::new(&env, &bounty.token).transfer(
            &env.current_contract_address(),
            &bounty.creator,
            &bounty.amount,
        );
    }

    pub fn get_bounty(env: Env, bounty_id: u64) -> Option<CompetitiveBounty> {
        env.storage().persistent().get(&DataKey::Bounty(bounty_id))
    }

    // --------------------------------------------------------------------
    // FUNDED MILESTONE PAYROLL AND SIGN-OFF GATES (#209)
    // --------------------------------------------------------------------

    /// Create an agreement of up to 12 stages, funding ALL stages atomically.
    /// Contractors cannot withdraw without an explicit merchant-approved release.
    pub fn create_milestone_project(
        env: Env,
        merchant: Address,
        contractor: Address,
        token: Address,
        input_stages: Vec<MilestoneInput>,
    ) -> u64 {
        merchant.require_auth();
        assert!(
            !input_stages.is_empty() && input_stages.len() <= 12,
            "invalid milestone count"
        );
        assert!(
            merchant != contractor,
            "merchant and contractor must differ"
        );
        let mut stages = Vec::<MilestoneStage>::new(&env);
        let mut total = 0i128;
        for input in input_stages.iter() {
            assert!(
                !input.title.is_empty() && input.title.len() <= 120,
                "invalid title"
            );
            assert!(
                input.deliverable_url.len() <= 512,
                "deliverable URL too long"
            );
            assert!(input.amount > 0, "milestone amount must be positive");
            assert!(
                input.due_timestamp > env.ledger().timestamp(),
                "milestone due date must be in future"
            );
            total = total
                .checked_add(input.amount)
                .expect("milestone amount overflow");
            stages.push_back(MilestoneStage {
                title: input.title,
                deliverable_url: input.deliverable_url,
                amount: input.amount,
                due_timestamp: input.due_timestamp,
                proof_url: String::from_str(&env, ""),
                review_feedback: String::from_str(&env, ""),
                submitted: false,
                released: false,
            });
        }
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextMilestoneProjectId)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::NextMilestoneProjectId,
            &id.checked_add(1).expect("project id overflow"),
        );
        token::Client::new(&env, &token).transfer(
            &merchant,
            env.current_contract_address(),
            &total,
        );
        let project = MilestoneProject {
            id,
            merchant: merchant.clone(),
            contractor: contractor.clone(),
            token,
            escrowed: total,
            released_amount: 0,
            stages,
        };
        let key = DataKey::MilestoneProject(id);
        env.storage().persistent().set(&key, &project);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, MIN_TTL_LEDGERS);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD_LEDGERS, MIN_TTL_LEDGERS);
        env.events().publish(
            (Symbol::new(&env, "milestones_created"), id),
            (merchant, contractor, total),
        );
        id
    }

    /// The registered contractor submits proof; merchant remains the only
    /// actor who can move escrowed funds. A revised proof reopens review.
    pub fn submit_milestone_deliverable(
        env: Env,
        contractor: Address,
        project_id: u64,
        stage_index: u32,
        proof_url: String,
    ) {
        contractor.require_auth();
        assert!(
            !proof_url.is_empty() && proof_url.len() <= 512,
            "invalid proof URL"
        );
        let key = DataKey::MilestoneProject(project_id);
        let mut project: MilestoneProject = env
            .storage()
            .persistent()
            .get(&key)
            .expect("unknown project");
        assert_eq!(
            project.contractor, contractor,
            "only assigned contractor may submit"
        );
        let mut stage = project.stages.get(stage_index).expect("unknown milestone");
        assert!(!stage.released, "milestone already released");
        stage.proof_url = proof_url;
        stage.review_feedback = String::from_str(&env, "");
        stage.submitted = true;
        project.stages.set(stage_index, stage);
        env.storage().persistent().set(&key, &project);
        env.events().publish(
            (Symbol::new(&env, "milestone_submitted"), project_id),
            stage_index,
        );
    }

    /// Merchant feedback explicitly blocks release until a new proof is submitted.
    pub fn request_milestone_changes(
        env: Env,
        merchant: Address,
        project_id: u64,
        stage_index: u32,
        feedback: String,
    ) {
        merchant.require_auth();
        assert!(
            !feedback.is_empty() && feedback.len() <= 512,
            "invalid review feedback"
        );
        let key = DataKey::MilestoneProject(project_id);
        let mut project: MilestoneProject = env
            .storage()
            .persistent()
            .get(&key)
            .expect("unknown project");
        assert_eq!(
            project.merchant, merchant,
            "only project merchant may review"
        );
        let mut stage = project.stages.get(stage_index).expect("unknown milestone");
        assert!(
            !stage.released && stage.submitted,
            "milestone not under review"
        );
        stage.submitted = false;
        stage.review_feedback = feedback;
        project.stages.set(stage_index, stage);
        env.storage().persistent().set(&key, &project);
        env.events().publish(
            (Symbol::new(&env, "milestone_changes"), project_id),
            stage_index,
        );
    }

    /// Freighter-signed merchant authorization releases exactly one stage.
    /// State changes and token transfer are atomic; a failed transfer rolls back.
    pub fn approve_and_release_milestone(
        env: Env,
        merchant: Address,
        project_id: u64,
        stage_index: u32,
    ) {
        merchant.require_auth();
        let key = DataKey::MilestoneProject(project_id);
        let mut project: MilestoneProject = env
            .storage()
            .persistent()
            .get(&key)
            .expect("unknown project");
        assert_eq!(project.merchant, merchant, "only merchant may approve");
        let mut stage = project.stages.get(stage_index).expect("unknown milestone");
        assert!(
            stage.submitted && !stage.released,
            "milestone is not awaiting approval"
        );
        // Enforce release order so later milestone approvals cannot bypass earlier stages.
        for earlier in 0..stage_index {
            assert!(
                project
                    .stages
                    .get(earlier)
                    .expect("earlier stage missing")
                    .released,
                "earlier milestone must be released first"
            );
        }
        stage.released = true;
        let amount = stage.amount;
        project.stages.set(stage_index, stage);
        project.released_amount = project
            .released_amount
            .checked_add(amount)
            .expect("release overflow");
        assert!(
            project.released_amount <= project.escrowed,
            "escrow budget exceeded"
        );
        env.storage().persistent().set(&key, &project);
        token::Client::new(&env, &project.token).transfer(
            &env.current_contract_address(),
            &project.contractor,
            &amount,
        );
        env.events().publish(
            (
                Symbol::new(&env, "milestone_released"),
                project_id,
                stage_index,
            ),
            (project.contractor, amount),
        );
    }

    pub fn get_milestone_project(env: Env, project_id: u64) -> Option<MilestoneProject> {
        env.storage()
            .persistent()
            .get(&DataKey::MilestoneProject(project_id))
    }

    // --------------------------------------------------------------------
    // PAYROLL ESCROW & UNCLAIMED RECLAMATION (#188)
    // --------------------------------------------------------------------

    /// Deposit `amount` of `token` into contract escrow for `recipient`. The
    /// recipient may claim until `expiration_timestamp`; after that the sender can
    /// reclaim whatever was never claimed. Returns the new payroll id.
    pub fn create_payroll_escrow(
        env: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        amount: i128,
        expiration_timestamp: u64,
    ) -> u64 {
        sender.require_auth();
        assert!(amount > 0, "amount must be positive");
        let now = env.ledger().timestamp();
        assert!(
            expiration_timestamp > now,
            "expiration_timestamp must be in the future"
        );

        let counter_key = DataKey::NextPayrollEscrowId;
        let id: u64 = env.storage().instance().get(&counter_key).unwrap_or(0);
        env.storage().instance().set(
            &counter_key,
            &id.checked_add(1).expect("Payroll escrow ID exhausted"),
        );

        // Pull the deposit into the contract before recording it, so a failed
        // transfer reverts the whole call and leaves no record behind.
        token::Client::new(&env, &token).transfer_from(
            &env.current_contract_address(),
            &sender,
            &env.current_contract_address(),
            &amount,
        );

        let escrow = PayrollEscrow {
            id,
            sender: sender.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            total_deposited: amount,
            claimed_amount: 0,
            expiration_timestamp,
            reclaimed: false,
        };
        save_payroll_escrow(&env, &escrow);

        env.events().publish(
            (Symbol::new(&env, "payroll_escrow_created"), sender, id),
            (recipient, token, amount, expiration_timestamp),
        );
        id
    }

    /// Recipient withdraws up to the unclaimed balance. Claims are only accepted
    /// while `now <= expiration_timestamp`.
    pub fn claim_payroll_escrow(env: Env, recipient: Address, payroll_id: u64, amount: i128) {
        recipient.require_auth();
        assert!(amount > 0, "amount must be positive");

        let mut escrow = load_payroll_escrow(&env, payroll_id);
        assert!(escrow.recipient == recipient, "Not the payroll recipient");
        assert!(!escrow.reclaimed, "Payroll escrow already reclaimed");
        assert!(
            env.ledger().timestamp() <= escrow.expiration_timestamp,
            "Claim window has expired"
        );
        let unclaimed = escrow.total_deposited - escrow.claimed_amount;
        assert!(amount <= unclaimed, "amount exceeds unclaimed balance");

        escrow.claimed_amount += amount;
        save_payroll_escrow(&env, &escrow);

        token::Client::new(&env, &escrow.token).transfer(
            &env.current_contract_address(),
            &recipient,
            &amount,
        );

        env.events().publish(
            (
                Symbol::new(&env, "payroll_escrow_claimed"),
                recipient,
                payroll_id,
            ),
            (escrow.token, amount),
        );
    }

    /// Returns the unclaimed balance of a payroll escrow to its sender once the
    /// claim window has closed (`now > expiration_timestamp`). The escrow is marked
    /// reclaimed before any transfer, so it can only ever be reclaimed once.
    pub fn reclaim_unclaimed_payroll(env: Env, sender: Address, payroll_id: u64) -> i128 {
        sender.require_auth();

        let mut escrow = load_payroll_escrow(&env, payroll_id);
        assert!(escrow.sender == sender, "Not the payroll sender");
        assert!(!escrow.reclaimed, "Payroll escrow already reclaimed");
        assert!(
            env.ledger().timestamp() > escrow.expiration_timestamp,
            "Expiration timestamp has not passed"
        );

        let unclaimed = escrow.total_deposited - escrow.claimed_amount;
        assert!(unclaimed > 0, "No unclaimed balance to reclaim");

        escrow.reclaimed = true;
        save_payroll_escrow(&env, &escrow);

        token::Client::new(&env, &escrow.token).transfer(
            &env.current_contract_address(),
            &sender,
            &unclaimed,
        );

        env.events().publish(
            (
                Symbol::new(&env, "payroll_escrow_reclaimed"),
                sender,
                payroll_id,
            ),
            (escrow.token, unclaimed),
        );
        unclaimed
    }

    /// Cancels a payroll batch before it is fully paid out (#287). Only the
    /// creator can cancel. The unclaimed balance is refunded to the creator in
    /// one transfer and the batch is marked `reclaimed`, which blocks any later
    /// claim, reclaim or cancel. Amounts recipients already claimed are kept.
    /// Returns the refunded amount.
    pub fn cancel_batch_payroll(env: Env, sender: Address, batch_id: u64) -> i128 {
        sender.require_auth();

        let mut batch = load_payroll_escrow(&env, batch_id);
        assert!(batch.sender == sender, "Not the batch creator");
        assert!(!batch.reclaimed, "Batch already cancelled or reclaimed");

        let unclaimed = batch.total_deposited - batch.claimed_amount;
        assert!(unclaimed > 0, "No unclaimed balance to refund");

        // Mark before transferring so the batch can only be cancelled once.
        batch.reclaimed = true;
        save_payroll_escrow(&env, &batch);

        token::Client::new(&env, &batch.token).transfer(
            &env.current_contract_address(),
            &sender,
            &unclaimed,
        );

        env.events().publish(
            (
                Symbol::new(&env, "payroll_batch_cancelled"),
                sender,
                batch_id,
            ),
            (batch.token, unclaimed),
        );
        unclaimed
    }

    /// Read a payroll escrow record. Requires no authorization.
    pub fn get_payroll_escrow(env: Env, payroll_id: u64) -> Option<PayrollEscrow> {
        env.storage()
            .persistent()
            .get(&DataKey::PayrollEscrow(payroll_id))
    }

    // --------------------------------------------------------------------
    // MERKLE PAYROLL DISTRIBUTION (#156)
    // --------------------------------------------------------------------

    /// Escrow `total_amount` of `token` for a payroll described by
    /// `merkle_root`, whose leaves are `SHA256(recipient_xdr || amount_be)`.
    /// Recipients claim until `now + duration_seconds`. Returns the claim id.
    pub fn create_merkle_payroll(
        env: Env,
        sender: Address,
        token: Address,
        merkle_root: BytesN<32>,
        total_amount: i128,
        duration_seconds: u64,
    ) -> u64 {
        sender.require_auth();
        assert!(total_amount > 0, "amount must be positive");
        assert!(duration_seconds > 0, "duration must be positive");
        let expiration_timestamp = env
            .ledger()
            .timestamp()
            .checked_add(duration_seconds)
            .expect("expiration overflow");

        let counter_key = DataKey::NextMerklePayrollId;
        let id: u64 = env.storage().instance().get(&counter_key).unwrap_or(0);
        env.storage().instance().set(
            &counter_key,
            &id.checked_add(1).expect("Merkle payroll ID exhausted"),
        );

        // Lock the whole payroll before publishing the root, so a failed
        // transfer reverts the call and leaves no claimable distribution.
        token::Client::new(&env, &token).transfer_from(
            &env.current_contract_address(),
            &sender,
            &env.current_contract_address(),
            &total_amount,
        );

        let payroll = MerklePayrollData {
            sender: sender.clone(),
            token: token.clone(),
            merkle_root: merkle_root.clone(),
            total_deposited: total_amount,
            claimed_amount: 0,
            expiration_timestamp,
        };
        save_merkle_payroll(&env, id, &payroll);

        env.events().publish(
            (Symbol::new(&env, "merkle_payroll_created"), sender, id),
            (token, merkle_root, total_amount, expiration_timestamp),
        );
        id
    }

    /// Pay `amount` to `recipient` if `proof` shows `(recipient, amount)` is a
    /// leaf of the payroll's root. Permissionless: funds only ever go to the
    /// proven recipient, so a relayer may submit the claim on their behalf.
    /// Each leaf can be claimed once.
    pub fn claim_merkle_payroll(
        env: Env,
        claim_id: u64,
        recipient: Address,
        amount: i128,
        proof: Vec<BytesN<32>>,
    ) {
        assert!(amount > 0, "amount must be positive");
        let mut payroll = load_merkle_payroll(&env, claim_id);
        assert!(
            env.ledger().timestamp() <= payroll.expiration_timestamp,
            "Claim window has expired"
        );

        let leaf = merkle_leaf(&env, &recipient, amount);
        assert!(
            verify_merkle_proof(&env, &proof, &payroll.merkle_root, &leaf),
            "Invalid Merkle proof"
        );

        let claimed_key = DataKey::MerkleClaimed(claim_id, leaf);
        assert!(
            !env.storage().persistent().has(&claimed_key),
            "Leaf already claimed"
        );
        let claimed_amount = payroll
            .claimed_amount
            .checked_add(amount)
            .expect("claimed amount overflow");
        assert!(
            claimed_amount <= payroll.total_deposited,
            "amount exceeds unclaimed balance"
        );

        // Record the claim before transferring, so the leaf can never pay twice
        payroll.claimed_amount = claimed_amount;
        save_merkle_payroll(&env, claim_id, &payroll);
        env.storage().persistent().set(&claimed_key, &true);
        let (threshold, extend_to) = calculate_ttl_params(
            payroll
                .expiration_timestamp
                .saturating_sub(env.ledger().timestamp()),
        );
        env.storage()
            .persistent()
            .extend_ttl(&claimed_key, threshold, extend_to);

        token::Client::new(&env, &payroll.token).transfer(
            &env.current_contract_address(),
            &recipient,
            &amount,
        );

        env.events().publish(
            (
                Symbol::new(&env, "merkle_payroll_claimed"),
                recipient,
                claim_id,
            ),
            (payroll.token, amount),
        );
    }

    /// Returns the unclaimed remainder of a Merkle payroll to its sender once
    /// the claim window has closed. Marks the payroll fully settled first, so
    /// it can only be reclaimed once.
    pub fn reclaim_merkle_payroll(env: Env, sender: Address, claim_id: u64) -> i128 {
        sender.require_auth();
        let mut payroll = load_merkle_payroll(&env, claim_id);
        assert!(payroll.sender == sender, "Not the payroll sender");
        assert!(
            env.ledger().timestamp() > payroll.expiration_timestamp,
            "Expiration timestamp has not passed"
        );
        let unclaimed = payroll.total_deposited - payroll.claimed_amount;
        assert!(unclaimed > 0, "No unclaimed balance to reclaim");

        payroll.claimed_amount = payroll.total_deposited;
        save_merkle_payroll(&env, claim_id, &payroll);

        token::Client::new(&env, &payroll.token).transfer(
            &env.current_contract_address(),
            &sender,
            &unclaimed,
        );

        env.events().publish(
            (
                Symbol::new(&env, "merkle_payroll_reclaimed"),
                sender,
                claim_id,
            ),
            (payroll.token, unclaimed),
        );
        unclaimed
    }

    /// Read a Merkle payroll distribution. Requires no authorization.
    pub fn get_merkle_payroll(env: Env, claim_id: u64) -> Option<MerklePayrollData> {
        env.storage()
            .persistent()
            .get(&DataKey::MerklePayroll(claim_id))
    }

    /// Whether the `(recipient, amount)` leaf of a Merkle payroll was claimed.
    pub fn is_merkle_leaf_claimed(
        env: Env,
        claim_id: u64,
        recipient: Address,
        amount: i128,
    ) -> bool {
        let leaf = merkle_leaf(&env, &recipient, amount);
        env.storage()
            .persistent()
            .has(&DataKey::MerkleClaimed(claim_id, leaf))
    }

    // --------------------------------------------------------------------
    // ADMIN-CONFIGURED REWARD MERKLE ROOT (#302)
    // --------------------------------------------------------------------

    /// Stores the global reward Merkle root and the token used to pay claims.
    /// Rotations require the reward administrator established by the first
    /// call (the protocol admin when one is configured). The administrator must
    /// also approve an allowance to this contract for claim payouts.
    pub fn set_reward_root(env: Env, admin: Address, token: Address, root: BytesN<32>) {
        admin.require_auth();
        if root.to_array() == [0u8; 32] {
            panic_with_error!(&env, OrbitContractError::InvalidMerkleRoot);
        }
        let reward_admin_key = FeatureKey::RewardAdmin;
        match env
            .storage()
            .persistent()
            .get::<_, Address>(&reward_admin_key)
        {
            Some(current) if current == admin => (),
            Some(_) => panic_with_error!(&env, OrbitContractError::UnauthorizedRootUpdate),
            None => {
                // One-time bootstrap: use the protocol admin when available,
                // otherwise the first caller becomes the reward administrator.
                if let Some(global_admin) = env
                    .storage()
                    .persistent()
                    .get::<_, Address>(&FeatureKey::Admin)
                {
                    if global_admin != admin {
                        panic_with_error!(&env, OrbitContractError::UnauthorizedRootUpdate);
                    }
                }
                env.storage().persistent().set(&reward_admin_key, &admin);
                extend_feature_key(
                    &env,
                    &reward_admin_key,
                    MIN_TTL_LEDGERS as u64 * SECONDS_PER_LEDGER,
                );
            }
        }
        env.storage()
            .persistent()
            .set(&FeatureKey::RewardMerkleRoot, &root);
        env.storage()
            .persistent()
            .set(&FeatureKey::RewardToken, &token);
        extend_feature_key(
            &env,
            &FeatureKey::RewardMerkleRoot,
            MIN_TTL_LEDGERS as u64 * SECONDS_PER_LEDGER,
        );
        extend_feature_key(
            &env,
            &FeatureKey::RewardToken,
            MIN_TTL_LEDGERS as u64 * SECONDS_PER_LEDGER,
        );
        env.events()
            .publish((Symbol::new(&env, "reward_root_set"), admin), (token, root));
    }

    /// Current reward root, if one has been configured.
    pub fn get_reward_root(env: Env) -> Option<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&FeatureKey::RewardMerkleRoot)
    }

    /// Administrator authorized to rotate the reward root and fund claims.
    pub fn get_reward_admin(env: Env) -> Option<Address> {
        env.storage().persistent().get(&FeatureKey::RewardAdmin)
    }

    /// Whether `claimant` has already claimed against the reward root.
    pub fn is_reward_claimed(env: Env, claimant: Address) -> bool {
        env.storage()
            .persistent()
            .has(&FeatureKey::RewardClaim(claimant))
    }

    /// Claims a reward if `(claimant, amount)` is a leaf of the configured
    /// Merkle root. Leaf encoding is canonical (`reward_leaf`) and sibling
    /// ordering is handled by `merkle_hash_pair`. The claimant signs, and each
    /// address may claim at most once.
    pub fn claim_reward(env: Env, claimant: Address, amount: i128, proof: Vec<BytesN<32>>) {
        claimant.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, OrbitContractError::InvalidRewardAmount);
        }
        let root: BytesN<32> = match env
            .storage()
            .persistent()
            .get(&FeatureKey::RewardMerkleRoot)
        {
            Some(root) => root,
            None => panic_with_error!(&env, OrbitContractError::MissingMerkleRoot),
        };
        let leaf = reward_leaf(&env, &claimant, amount);
        if !verify_merkle_proof(&env, &proof, &root, &leaf) {
            panic_with_error!(&env, OrbitContractError::InvalidMerkleProof);
        }
        let claim_key = FeatureKey::RewardClaim(claimant.clone());
        if env.storage().persistent().has(&claim_key) {
            panic_with_error!(&env, OrbitContractError::AlreadyClaimed);
        }
        let token: Address = env
            .storage()
            .persistent()
            .get(&FeatureKey::RewardToken)
            .expect("Reward token is not configured");
        let admin: Address = env
            .storage()
            .persistent()
            .get(&FeatureKey::RewardAdmin)
            .expect("No reward administrator configured");

        // Mark before the external transfer; a failed transfer reverts both.
        env.storage().persistent().set(&claim_key, &true);
        extend_feature_key(
            &env,
            &claim_key,
            MIN_TTL_LEDGERS as u64 * SECONDS_PER_LEDGER,
        );
        token::Client::new(&env, &token).transfer_from(
            &env.current_contract_address(),
            &admin,
            &claimant,
            &amount,
        );
        env.events().publish(
            (Symbol::new(&env, "reward_claimed"), claimant),
            (token, amount),
        );
    }

    // --------------------------------------------------------------------
    // ON-CHAIN PLAN CATALOG (#95)
    // --------------------------------------------------------------------

    /// Register a plan in the public on-chain catalog under merchant authority.
    /// Re-registering an existing `plan_id` is only allowed for the merchant
    /// that already owns it (it refreshes the terms and reactivates the plan).
    pub fn register_plan(
        env: Env,
        merchant: Address,
        plan_id: String,
        token: Address,
        amount_per_interval: i128,
        interval_seconds: u64,
        name: String,
    ) {
        merchant.require_auth();

        assert!(
            amount_per_interval > 0,
            "amount_per_interval must be positive"
        );
        assert!(
            interval_seconds > 0,
            "interval_seconds must be greater than zero"
        );

        let key = PlanKey {
            plan_id: plan_id.clone(),
        };
        if let Some(existing) = env.storage().persistent().get::<PlanKey, PlanData>(&key) {
            assert!(
                existing.merchant == merchant,
                "Plan ID is already registered by another merchant"
            );
        }

        let plan = PlanData {
            merchant: merchant.clone(),
            token: token.clone(),
            amount_per_interval,
            interval_seconds,
            name: name.clone(),
            is_active: true,
        };
        env.storage().persistent().set(&key, &plan);

        env.events().publish(
            (Symbol::new(&env, "plan_registered"), merchant, plan_id),
            (token, amount_per_interval, interval_seconds, name),
        );

        let (threshold, extend_to) = calculate_ttl_params(interval_seconds);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold, extend_to);
        env.storage().instance().extend_ttl(threshold, extend_to);
    }

    /// Disable new subscriptions for a plan. Existing vaults created from the
    /// plan keep running, so in-flight subscribers are unaffected (#95).
    pub fn deactivate_plan(env: Env, merchant: Address, plan_id: String) {
        merchant.require_auth();

        let key = PlanKey {
            plan_id: plan_id.clone(),
        };
        let mut plan: PlanData = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Plan does not exist");
        assert!(
            plan.merchant == merchant,
            "Only the owning merchant can deactivate this plan"
        );

        plan.is_active = false;
        env.storage().persistent().set(&key, &plan);

        env.events().publish(
            (Symbol::new(&env, "plan_deactivated"), merchant, plan_id),
            (),
        );

        let (threshold, extend_to) = calculate_ttl_params(plan.interval_seconds);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold, extend_to);
        env.storage().instance().extend_ttl(threshold, extend_to);
    }

    /// Public read helper for the on-chain plan catalog. No authorization and
    /// no storage mutation.
    pub fn get_plan(env: Env, plan_id: String) -> Option<PlanData> {
        let key = PlanKey { plan_id };
        env.storage().persistent().get(&key)
    }

    /// Create a vault using terms read directly from the on-chain catalog, so
    /// the subscriber never has to trust off-chain plan metadata. Rejects
    /// deactivated plans while leaving existing vaults untouched (#95).
    pub fn create_vault_from_plan(env: Env, user: Address, plan_id: String) {
        user.require_auth();

        let key = PlanKey { plan_id };
        let plan: PlanData = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Plan does not exist");
        assert!(plan.is_active, "Plan is not active");

        write_vault(
            &env,
            &user,
            &plan.merchant,
            &plan.token,
            plan.amount_per_interval,
            plan.interval_seconds,
            DEFAULT_GRACE_PERIOD_SECONDS,
            0,
            0,
        );
    }

    // --------------------------------------------------------------------
    // YIELD-BEARING COLLATERAL STRATEGY (#176)
    // --------------------------------------------------------------------

    /// Configure an automated yield strategy for idle contract escrow. When
    /// escrow balances exceed the `liquidity_buffer`, excess tokens are
    /// automatically deployed to the approved lending pool to generate yield.
    pub fn configure_yield_strategy(
        env: Env,
        admin: Address,
        yield_pool: Address,
        token: Address,
        liquidity_buffer: i128,
    ) {
        admin.require_auth();
        assert!(
            liquidity_buffer >= 0,
            "Liquidity buffer must be non-negative"
        );

        let key = FeatureKey::YieldStrategy;
        let config = YieldStrategyConfig {
            yield_pool: Some(yield_pool.clone()),
            token: token.clone(),
            liquidity_buffer,
            total_deployed: 0,
        };
        env.storage().persistent().set(&key, &config);
        extend_feature_key(&env, &key, MIN_TTL_LEDGERS as u64 * SECONDS_PER_LEDGER);

        env.events().publish(
            (Symbol::new(&env, "yield_strategy_configured"), admin),
            (yield_pool, token, liquidity_buffer),
        );
    }

    /// Deploy excess idle capital to the configured yield market. This checks
    /// the contract's token balance against the liquidity buffer and supplies
    /// the surplus to the lending pool to earn passive interest.
    pub fn deploy_idle_capital(env: Env, token: Address) {
        let key = FeatureKey::YieldStrategy;
        let mut config: YieldStrategyConfig = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Yield strategy not configured");
        assert!(config.token == token, "Wrong token for yield strategy");

        let pool_address = config
            .yield_pool
            .as_ref()
            .expect("No yield pool configured");
        let contract_addr = env.current_contract_address();
        let token_client = token::Client::new(&env, &token);
        let current_balance = token_client.balance(&contract_addr);

        let deployable = current_balance
            .checked_sub(config.liquidity_buffer)
            .unwrap_or(0);
        assert!(deployable > 0, "No excess capital to deploy");

        // Supply tokens to the lending pool
        let pool_client = LendingPoolClient::new(&env, pool_address);
        pool_client.supply(&token, &deployable, &contract_addr);

        config.total_deployed = config
            .total_deployed
            .checked_add(deployable)
            .expect("Total deployed overflow");
        env.storage().persistent().set(&key, &config);
        extend_feature_key(&env, &key, MIN_TTL_LEDGERS as u64 * SECONDS_PER_LEDGER);

        env.events().publish(
            (Symbol::new(&env, "capital_deployed"), token),
            (deployable, config.total_deployed),
        );
    }

    /// Redeem principal plus accrued interest from the yield market. This is
    /// called when merchants withdraw funds or escrow is released, ensuring
    /// available liquidity while capturing the earned yield.
    pub fn redeem_yield_principal(env: Env, token: Address, amount: i128) {
        assert!(amount > 0, "Redemption amount must be positive");

        let key = FeatureKey::YieldStrategy;
        let mut config: YieldStrategyConfig = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Yield strategy not configured");
        assert!(config.token == token, "Wrong token for yield strategy");

        let pool_address = config
            .yield_pool
            .as_ref()
            .expect("No yield pool configured");
        let contract_addr = env.current_contract_address();

        // Withdraw from the lending pool (principal + interest)
        let pool_client = LendingPoolClient::new(&env, pool_address);
        let redeemed = pool_client.withdraw(&token, &amount, &contract_addr);
        assert!(redeemed >= amount, "Insufficient yield pool liquidity");

        config.total_deployed = config
            .total_deployed
            .checked_sub(amount.min(config.total_deployed))
            .unwrap_or(0);
        env.storage().persistent().set(&key, &config);
        extend_feature_key(&env, &key, MIN_TTL_LEDGERS as u64 * SECONDS_PER_LEDGER);

        let yield_earned = redeemed.saturating_sub(amount);
        env.events().publish(
            (Symbol::new(&env, "principal_redeemed"), token),
            (amount, redeemed, yield_earned),
        );
    }

    /// Emergency unwind: immediately withdraw all deployed funds from the yield
    /// market back to the base contract. This is admin-guarded and used when
    /// market utilization spikes or safety concerns require immediate liquidity.
    pub fn emergency_unwind_yield(env: Env, admin: Address) {
        admin.require_auth();

        let key = FeatureKey::YieldStrategy;
        let mut config: YieldStrategyConfig = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Yield strategy not configured");

        let pool_address = config
            .yield_pool
            .as_ref()
            .expect("No yield pool configured");
        let contract_addr = env.current_contract_address();
        let pool = LendingPoolClient::new(&env, pool_address);

        // Query the contract's balance in the lending pool
        let pool_balance = pool.balance_of(&config.token, &contract_addr);
        if pool_balance > 0 {
            let recovered = pool.withdraw(&config.token, &pool_balance, &contract_addr);

            config.total_deployed = 0;
            env.storage().persistent().set(&key, &config);

            env.events().publish(
                (Symbol::new(&env, "emergency_yield_unwind"), admin),
                (config.token, recovered),
            );
        }
    }

    /// Read the current yield strategy configuration. No authorization required.
    pub fn get_yield_strategy(env: Env) -> Option<YieldStrategyConfig> {
        env.storage().persistent().get(&FeatureKey::YieldStrategy)
    }

    // --------------------------------------------------------------------
    // MULTI-TOKEN BASKET BILLING (#166)
    // --------------------------------------------------------------------

    /// Configure a multi-token subscription basket. The subscriber must approve
    /// each token to this contract for the matching amount before pulls settle.
    pub fn create_basket_vault(
        env: Env,
        user: Address,
        merchant: Address,
        tokens: Vec<Address>,
        amounts: Vec<i128>,
        interval_seconds: u64,
    ) {
        user.require_auth();
        assert!(
            tokens.len() == amounts.len(),
            "tokens and amounts length mismatch"
        );
        assert!(!tokens.is_empty(), "basket must not be empty");
        assert!(
            interval_seconds > 0,
            "interval_seconds must be greater than zero"
        );
        for amount in amounts.iter() {
            assert!(amount > 0, "amounts must be positive");
        }

        let key = DataKey::BasketVault(user.clone(), merchant.clone());
        let data = BasketVaultData {
            tokens: tokens.clone(),
            amounts_per_interval: amounts.clone(),
            interval_seconds,
            last_pull_timestamp: 0,
        };
        env.storage().persistent().set(&key, &data);
        let (threshold, extend_to) = calculate_ttl_params(interval_seconds);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold, extend_to);
        env.storage().instance().extend_ttl(threshold, extend_to);
        env.events().publish(
            (Symbol::new(&env, "basket_vault_created"), user, merchant),
            (tokens, amounts, interval_seconds),
        );
    }

    pub fn get_basket_vault(env: Env, user: Address, merchant: Address) -> Option<BasketVaultData> {
        env.storage()
            .persistent()
            .get(&DataKey::BasketVault(user, merchant))
    }

    /// Pull every token in the basket in one atomic invocation. Any single
    /// failing transfer (insufficient allowance or balance) reverts the whole
    /// pull, so partial basket settlement can never occur.
    pub fn pull_basket_funds(env: Env, user: Address, merchant: Address) {
        merchant.require_auth();

        let key = DataKey::BasketVault(user.clone(), merchant.clone());
        let mut data: BasketVaultData = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Basket vault does not exist");

        let current_time = env.ledger().timestamp();
        if data.last_pull_timestamp != 0 {
            assert!(
                current_time >= data.last_pull_timestamp + data.interval_seconds,
                "Too early to pull basket funds"
            );
        }

        let contract = env.current_contract_address();
        for i in 0..data.tokens.len() {
            let token = data.tokens.get(i).unwrap();
            let amount = data.amounts_per_interval.get(i).unwrap();
            token::Client::new(&env, &token).transfer_from(&contract, &user, &merchant, &amount);
        }

        data.last_pull_timestamp = current_time;
        env.storage().persistent().set(&key, &data);
        let (threshold, extend_to) = calculate_ttl_params(data.interval_seconds);
        env.storage()
            .persistent()
            .extend_ttl(&key, threshold, extend_to);
        env.events().publish(
            (Symbol::new(&env, "basket_funds_pulled"), user, merchant),
            (current_time, data.tokens.len()),
        );
    }

    // --------------------------------------------------------------------
    // LOYALTY STAKING & COMMITMENT DISCOUNTS (#180)
    // --------------------------------------------------------------------

    /// Configure the loyalty tiers offered to this merchant's subscribers.
    pub fn configure_loyalty_tiers(env: Env, merchant: Address, tiers: Vec<LoyaltyTier>) {
        merchant.require_auth();
        assert!(!tiers.is_empty(), "tiers must not be empty");
        assert!(tiers.len() <= MAX_LOYALTY_TIERS, "too many loyalty tiers");
        for tier in tiers.iter() {
            assert!(tier.min_lock_amount > 0, "min_lock_amount must be positive");
            assert!(
                tier.discount_bps > 0 && tier.discount_bps <= BPS_DENOMINATOR as u32,
                "discount_bps out of range"
            );
        }
        let key = FeatureKey::LoyaltyTiers(merchant.clone());
        env.storage().persistent().set(&key, &tiers);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, MIN_TTL_LEDGERS);
        env.events().publish(
            (Symbol::new(&env, "loyalty_tiers_configured"), merchant),
            tiers,
        );
    }

    pub fn get_loyalty_tiers(env: Env, merchant: Address) -> Option<Vec<LoyaltyTier>> {
        env.storage()
            .persistent()
            .get(&FeatureKey::LoyaltyTiers(merchant))
    }

    /// Lock loyalty tokens in contract escrow until `lock_duration_seconds`
    /// elapses. One active stake per subscriber.
    pub fn stake_loyalty_tokens(
        env: Env,
        user: Address,
        token: Address,
        amount: i128,
        lock_duration_seconds: u64,
    ) {
        user.require_auth();
        assert!(amount > 0, "amount must be positive");
        assert!(
            lock_duration_seconds > 0,
            "lock_duration_seconds must be positive"
        );
        let key = DataKey::LoyaltyStake(user.clone());
        assert!(
            !env.storage().persistent().has(&key),
            "Loyalty stake already active"
        );

        let lock_until = env
            .ledger()
            .timestamp()
            .checked_add(lock_duration_seconds)
            .expect("Lock end overflow");
        let contract = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&user, &contract, &amount);
        env.storage().persistent().set(
            &key,
            &LoyaltyStake {
                token: token.clone(),
                amount,
                lock_until,
            },
        );
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, MIN_TTL_LEDGERS);
        env.events().publish(
            (Symbol::new(&env, "loyalty_staked"), user),
            (token, amount, lock_until),
        );
    }

    /// Release locked loyalty tokens. Rejected until the lock period elapses.
    pub fn unstake_loyalty_tokens(env: Env, user: Address) {
        user.require_auth();
        let key = DataKey::LoyaltyStake(user.clone());
        let stake: LoyaltyStake = env
            .storage()
            .persistent()
            .get(&key)
            .expect("No loyalty stake");
        assert!(
            env.ledger().timestamp() >= stake.lock_until,
            "Loyalty tokens are still locked"
        );
        env.storage().persistent().remove(&key);
        let contract = env.current_contract_address();
        token::Client::new(&env, &stake.token).transfer(&contract, &user, &stake.amount);
        env.events().publish(
            (Symbol::new(&env, "loyalty_unstaked"), user),
            (stake.token, stake.amount),
        );
    }

    pub fn get_loyalty_stake(env: Env, user: Address) -> Option<LoyaltyStake> {
        env.storage().persistent().get(&DataKey::LoyaltyStake(user))
    }

    // --------------------------------------------------------------------
    // DELEGATED META-TRANSACTIONS (#207)
    // --------------------------------------------------------------------

    pub fn get_user_nonce(env: Env, user: Address) -> u64 {
        load_user_nonce(&env, &user)
    }

    /// Create a vault on behalf of `user` using a signed meta-transaction.
    /// The signature covers contract address, chain id, the current nonce, the
    /// function symbol, the parameters and the deadline.
    pub fn create_vault_with_signature(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
        amount_per_interval: i128,
        interval_seconds: u64,
        deadline: u64,
        signature: BytesN<64>,
    ) {
        assert!(env.ledger().timestamp() <= deadline, "Signature expired");
        let nonce = load_user_nonce(&env, &user);
        let digest = create_vault_meta_digest(
            &env,
            &user,
            &merchant,
            &token,
            amount_per_interval,
            interval_seconds,
            nonce,
            deadline,
        );
        verify_meta_signature(&env, &user, &digest, &signature);
        bump_user_nonce(&env, &user, nonce);
        write_vault(
            &env,
            &user,
            &merchant,
            &token,
            amount_per_interval,
            interval_seconds,
            DEFAULT_GRACE_PERIOD_SECONDS,
            0,
            0,
        );
        env.events().publish(
            (Symbol::new(&env, "vault_created_delegated"), user, merchant),
            (token, amount_per_interval, interval_seconds, deadline),
        );
    }

    /// Cancel a vault on behalf of `user` using a signed meta-transaction.
    pub fn cancel_vault_with_signature(
        env: Env,
        user: Address,
        merchant: Address,
        deadline: u64,
        signature: BytesN<64>,
    ) {
        assert!(env.ledger().timestamp() <= deadline, "Signature expired");
        let nonce = load_user_nonce(&env, &user);
        let digest = cancel_vault_meta_digest(&env, &user, &merchant, nonce, deadline);
        verify_meta_signature(&env, &user, &digest, &signature);
        bump_user_nonce(&env, &user, nonce);
        remove_vault(&env, &user, &merchant);
    }

    /// Create a vault from a subscriber-signed [`DelegatedVaultAuthorization`]
    /// (#296). Anyone, typically a relayer or fee-bump submitter, may call it,
    /// so a subscriber holding only USDC can onboard without XLM for fees.
    ///
    /// Checks, cheapest first: expiry, nonce, payload sanity, then a single
    /// Ed25519 verification over [`delegated_vault_digest`]. On success the
    /// subscriber's nonce is consumed, so the same signature can never be
    /// replayed. The nonce is shared with `create_vault_with_signature`, so
    /// the two signature schemes cannot be replayed into each other either.
    pub fn create_vault_delegated(
        env: Env,
        authorization: DelegatedVaultAuthorization,
        signature: BytesN<64>,
    ) -> Result<(), DelegatedAuthError> {
        if env.ledger().sequence() > authorization.expiry_ledger {
            return Err(DelegatedAuthError::SignatureExpired);
        }
        let current_nonce = load_user_nonce(&env, &authorization.user);
        if authorization.nonce != current_nonce {
            return Err(DelegatedAuthError::InvalidNonce);
        }
        if authorization.amount <= 0 || authorization.interval_ledgers == 0 {
            return Err(DelegatedAuthError::InvalidAuthorization);
        }
        let interval_seconds = u64::from(authorization.interval_ledgers)
            .checked_mul(SECONDS_PER_LEDGER)
            .ok_or(DelegatedAuthError::InvalidAuthorization)?;
        let pubkey = ed25519_account_key(&env, &authorization.user)
            .ok_or(DelegatedAuthError::InvalidSignature)?;

        let digest = delegated_vault_digest(&env, &authorization);
        env.crypto().ed25519_verify(
            &pubkey,
            &Bytes::from_array(&env, &digest.to_array()),
            &signature,
        );

        bump_user_nonce(&env, &authorization.user, current_nonce);
        write_vault(
            &env,
            &authorization.user,
            &authorization.merchant,
            &authorization.token,
            authorization.amount,
            interval_seconds,
            DEFAULT_GRACE_PERIOD_SECONDS,
            0,
            0,
        );
        env.events().publish(
            (
                Symbol::new(&env, "vault_delegated"),
                authorization.user,
                authorization.merchant,
            ),
            (
                authorization.token,
                authorization.amount,
                authorization.interval_ledgers,
                authorization.nonce,
            ),
        );
        Ok(())
    }

    /// Create up to 20 vaults in one relayed transaction (#379).
    ///
    /// Each signed payload covers user, merchant, token, amount, interval,
    /// nonce and expiry, plus the chain and this contract. The whole invocation
    /// is atomic: invalid nonce, expiry, terms or Ed25519 signature reverts
    /// **all** writes, including earlier entries in the vector. This avoids a
    /// misleading partially accepted cohort. Nonces are checked and consumed
    /// in input order, so duplicate authorizations in one batch cannot replay.
    ///
    /// The caller/relayer does not require any subscriber authorization beyond
    /// the included Ed25519 signatures. Use `delegated_batch_vault_digest`
    /// when constructing the signed message off-chain.
    pub fn batch_create_vaults_delegated(
        env: Env,
        authorizations: Vec<DelegatedVaultAuth>,
    ) -> Result<u32, DelegatedAuthError> {
        if authorizations.is_empty() || authorizations.len() > MAX_DELEGATED_VAULT_BATCH {
            return Err(DelegatedAuthError::InvalidAuthorization);
        }
        let mut created = 0u32;
        for auth in authorizations.iter() {
            // Soroban diagnostic logs retain the input position of the
            // authorization being evaluated, including host crypto failures.
            soroban_sdk::log!(&env, "delegated batch authorization index {}", created);
            if env.ledger().sequence() > auth.expiry_ledger {
                return Err(DelegatedAuthError::SignatureExpired);
            }
            let current_nonce = load_user_nonce(&env, &auth.user);
            if auth.nonce != current_nonce {
                return Err(DelegatedAuthError::InvalidNonce);
            }
            if auth.amount <= 0 || auth.interval_ledgers == 0 {
                return Err(DelegatedAuthError::InvalidAuthorization);
            }
            let interval_seconds = u64::from(auth.interval_ledgers)
                .checked_mul(SECONDS_PER_LEDGER)
                .ok_or(DelegatedAuthError::InvalidAuthorization)?;
            let pubkey = ed25519_account_key(&env, &auth.user)
                .ok_or(DelegatedAuthError::InvalidSignature)?;
            let digest = delegated_batch_vault_digest(&env, &auth);
            // Invalid signatures abort at the host boundary. Soroban then
            // rolls back the entire invocation and all earlier vault writes.
            env.crypto().ed25519_verify(
                &pubkey,
                &Bytes::from_array(&env, &digest.to_array()),
                &auth.signature,
            );
            bump_user_nonce(&env, &auth.user, current_nonce);
            write_vault(
                &env,
                &auth.user,
                &auth.merchant,
                &auth.token,
                auth.amount,
                interval_seconds,
                DEFAULT_GRACE_PERIOD_SECONDS,
                0,
                0,
            );
            env.events().publish(
                (
                    Symbol::new(&env, "vault_delegated"),
                    auth.user,
                    auth.merchant,
                ),
                (auth.token, auth.amount, auth.interval_ledgers, auth.nonce),
            );
            created = created.checked_add(1).expect("batch counter overflow");
        }
        Ok(created)
    }

    // -----------------------------------------------------------------------
    // MULTI-SIG GOVERNANCE & TIMELOCK (#255)
    // -----------------------------------------------------------------------

    /// Propose a new admin. The proposed admin must call `claim_admin` to confirm
    /// and complete the transfer of control.
    pub fn propose_admin(env: Env, current_admin: Address, new_admin: Address) {
        current_admin.require_auth();
        let admin_key = FeatureKey::Admin;
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&admin_key)
            .expect("No admin configured");
        assert!(
            stored_admin == current_admin,
            "Only the current admin can propose a new admin"
        );

        let proposed_key = DataKey::ProposedAdmin;
        env.storage().persistent().set(&proposed_key, &new_admin);
        extend_feature_key(
            &env,
            &admin_key,
            MIN_TTL_LEDGERS as u64 * SECONDS_PER_LEDGER,
        );

        env.events().publish(
            (Symbol::new(&env, "admin_proposed"), current_admin),
            new_admin,
        );
    }

    /// Confirm and claim admin privileges. Must be called by the proposed admin.
    pub fn claim_admin(env: Env, new_admin: Address) {
        new_admin.require_auth();

        let proposed_key = DataKey::ProposedAdmin;
        let proposed: Address = env
            .storage()
            .persistent()
            .get(&proposed_key)
            .expect("No admin proposal pending");
        assert!(proposed == new_admin, "You are not the proposed admin");

        let admin_key = FeatureKey::Admin;
        let old_admin: Address = env
            .storage()
            .persistent()
            .get(&admin_key)
            .expect("No admin configured");

        env.storage().persistent().set(&admin_key, &new_admin);
        env.storage().persistent().remove(&proposed_key);
        extend_feature_key(
            &env,
            &admin_key,
            MIN_TTL_LEDGERS as u64 * SECONDS_PER_LEDGER,
        );

        env.events().publish(
            (Symbol::new(&env, "admin_transferred"), old_admin),
            new_admin,
        );
    }

    /// Get the current admin. No authorization required.
    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().persistent().get(&FeatureKey::Admin)
    }

    /// Queue a protocol parameter update with a minimum timelock delay (~24 hours).
    /// The parameter must be queued before execution.
    pub fn queue_param_update(env: Env, admin: Address, param_name: Symbol, new_value: Bytes) {
        admin.require_auth();

        let admin_key = FeatureKey::Admin;
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&admin_key)
            .expect("No admin configured");
        assert!(
            stored_admin == admin,
            "Only the admin can queue parameter updates"
        );

        let now = env.ledger().timestamp();
        let timelock_duration: u64 = 17280 * 5; // ~24 hours in seconds (17,280 ledgers)
        let execute_after = now.saturating_add(timelock_duration);

        let entry = TimelockEntry {
            param_name: param_name.clone(),
            queued_at: now,
            execute_after,
            data: new_value,
        };

        let queue_key = DataKey::TimelockQueue(param_name.clone());
        env.storage().persistent().set(&queue_key, &entry);
        extend_feature_key(&env, &admin_key, timelock_duration);

        env.events().publish(
            (Symbol::new(&env, "param_queued"), param_name),
            (now, execute_after),
        );
    }

    /// Execute a queued parameter update after the timelock delay has elapsed.
    pub fn execute_param_update(env: Env, admin: Address, param_name: Symbol) {
        admin.require_auth();

        let admin_key = FeatureKey::Admin;
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&admin_key)
            .expect("No admin configured");
        assert!(
            stored_admin == admin,
            "Only the admin can execute parameter updates"
        );

        let queue_key = DataKey::TimelockQueue(param_name.clone());
        let entry: TimelockEntry = env
            .storage()
            .persistent()
            .get(&queue_key)
            .expect("No queued update for this parameter");

        let now = env.ledger().timestamp();
        assert!(now >= entry.execute_after, "Timelock has not elapsed yet");

        env.storage().persistent().remove(&queue_key);

        env.events().publish(
            (Symbol::new(&env, "param_executed"), param_name),
            (entry.queued_at, now),
        );
    }

    /// Get a queued parameter update. No authorization required.
    pub fn get_queued_param(env: Env, param_name: Symbol) -> Option<TimelockEntry> {
        env.storage()
            .persistent()
            .get(&DataKey::TimelockQueue(param_name))
    }

    // -----------------------------------------------------------------------
    // TTL EXTENSION HELPERS (#254)
    // -----------------------------------------------------------------------

    /// Proactively extend TTL for a vault's persistent storage. Anyone can call this
    /// to keep active subscription state live and prevent archival (#254).
    pub fn bump_vault_ttl(env: Env, user: Address, merchant: Address) {
        let key = vault_key(&user, &merchant);
        if let Some(vault) = load_vault(&env, &key) {
            let (threshold, extend_to) = calculate_ttl_params(vault.interval_seconds);
            env.storage()
                .persistent()
                .extend_ttl(&key, threshold, extend_to);
            env.storage().instance().extend_ttl(threshold, extend_to);
            env.events().publish(
                (Symbol::new(&env, "vault_ttl_bumped"), user, merchant),
                (threshold, extend_to),
            );
        }
    }

    // -----------------------------------------------------------------------
    // BATCH VAULT RENEWAL (#316)
    // -----------------------------------------------------------------------

    pub fn batch_renew_vaults(
        env: Env,
        user: Address,
        merchants: Vec<Address>,
        extension_ledgers: u64,
    ) {
        user.require_auth();

        let extension = extension_ledgers.min(u32::MAX as u64) as u32;
        let current_sequence = env.ledger().sequence();
        let mut renewed_count: u32 = 0;
        let mut newest_expiration: u32 = 0;

        for merchant in merchants.iter() {
            if extension == 0 {
                break;
            }
            let key = vault_key(&user, &merchant);
            let Some(mut vault) = load_vault(&env, &key) else {
                continue;
            };
            if remaining_vault_cap(&vault) == Some(0) {
                continue;
            }
            let base = if vault.expiration_ledger == UNLIMITED_EXPIRATION_LEDGER {
                current_sequence
            } else {
                vault.expiration_ledger.max(current_sequence)
            };
            let new_expiration = base.saturating_add(extension);
            vault.expiration_ledger = new_expiration;
            if vault.payment_status == PAYMENT_EXPIRED {
                vault.payment_status = PAYMENT_ACTIVE;
            }
            save_vault(&env, &key, &vault);
            let (threshold, extend_to) = calculate_ttl_params(vault.interval_seconds);
            env.storage()
                .persistent()
                .extend_ttl(&key, threshold, extend_to);
            env.storage().instance().extend_ttl(threshold, extend_to);
            renewed_count += 1;
            newest_expiration = newest_expiration.max(new_expiration);
        }

        env.events().publish(
            (Symbol::new(&env, "batch_vaults_renewed"), user),
            (renewed_count, newest_expiration),
        );
    }

    // ------------------------------------------------------------------------
    // #223: EMERGENCY PAUSE AND TIMELOCKED CIRCUIT BREAKER
    // ------------------------------------------------------------------------

    /// Bootstrap the protocol admin (first caller) or assert the caller is the
    /// already configured admin. The first call establishes the admin key that
    /// `propose_admin`/`claim_admin` later rotate.
    pub fn set_admin(env: Env, caller: Address) {
        bootstrap_or_require_admin(&env, &caller);
    }

    /// #354: swap this contract's WASM for bytecode that is already installed on
    /// the network. The protocol admin must authorize the call. The deploy
    /// orchestrator (`scripts/deploy.sh`) uploads the new build first, then calls
    /// this, so re-running the script upgrades the existing contract in place.
    pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>) {
        bootstrap_or_require_admin(&env, &caller);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        env.events()
            .publish((symbol_short!("upgraded"), caller), ());
    }

    /// Halt every fund-moving entrypoint. Guarded by the protocol admin.
    pub fn pause(env: Env, caller: Address) {
        bootstrap_or_require_admin(&env, &caller);
        let mut state = load_pause_state(&env);
        if !state.paused {
            state.paused = true;
            state.paused_at = env.ledger().timestamp();
            save_pause_state(&env, &state);
            env.events()
                .publish((symbol_short!("paused"), caller), state.paused_at);
        }
    }

    /// Resume normal operation. Guarded by the protocol admin.
    pub fn unpause(env: Env, caller: Address) {
        bootstrap_or_require_admin(&env, &caller);
        let mut state = load_pause_state(&env);
        assert!(state.paused, "Protocol is not paused");
        state.paused = false;
        state.paused_at = 0;
        save_pause_state(&env, &state);
        env.events().publish(
            (symbol_short!("unpaused"), caller),
            env.ledger().timestamp(),
        );
    }

    pub fn is_paused(env: Env) -> bool {
        load_pause_state(&env).paused
    }

    pub fn get_pause_state(env: Env) -> PauseState {
        load_pause_state(&env)
    }

    /// Escape hatch: once the pause has lasted longer than the safety window,
    /// a vault owner may cancel the vault and reclaim every pending escrow hold
    /// without waiting for the admin or the merchant.
    pub fn reclaim_paused_vault(env: Env, user: Address, merchant: Address) {
        user.require_auth();
        let state = load_pause_state(&env);
        assert!(state.paused, "Protocol is not paused");
        let now = env.ledger().timestamp();
        assert!(
            state.paused_at > 0
                && now
                    >= state
                        .paused_at
                        .saturating_add(PAUSE_RECOVERY_TIMELOCK_SECONDS),
            "Pause timelock has not elapsed"
        );

        let ids_key = FeatureKey::VaultEscrowIds(user.clone(), merchant.clone());
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&ids_key)
            .unwrap_or_else(|| Vec::new(&env));
        for id in ids.iter() {
            let hold_key = SubscriptionKey::Escrow(id);
            if let Some(hold) = env.storage().persistent().get::<_, EscrowHold>(&hold_key) {
                if hold.user == user
                    && hold.merchant == merchant
                    && !hold.disputed
                    && hold.amount > 0
                {
                    token::Client::new(&env, &hold.token).transfer(
                        &env.current_contract_address(),
                        &user,
                        &hold.amount,
                    );
                    env.events().publish(
                        (Symbol::new(&env, "pause_reclaim"), user.clone(), id),
                        hold.amount,
                    );
                }
                env.storage().persistent().remove(&hold_key);
            }
        }
        env.storage().persistent().remove(&ids_key);
        remove_vault(&env, &user, &merchant);
        env.events().publish(
            (
                Symbol::new(&env, "vault_reclaimed_after_pause"),
                user,
                merchant,
            ),
            now,
        );
    }

    // ------------------------------------------------------------------------
    // #224: PROTOCOL TREASURY FEE SPLIT
    // ------------------------------------------------------------------------

    /// Configure (or clear with `fee_bps = 0`) the protocol treasury fee.
    /// Basis points are capped at 10% to protect payers.
    pub fn set_protocol_fee(env: Env, caller: Address, fee_bps: u32, treasury: Address) {
        bootstrap_or_require_admin(&env, &caller);
        assert!(
            fee_bps <= MAX_PROTOCOL_FEE_BPS,
            "fee_bps must not exceed 1000"
        );
        let config = ProtocolFeeConfig {
            fee_bps,
            treasury: treasury.clone(),
        };
        env.storage()
            .persistent()
            .set(&FeatureKey::ProtocolFee, &config);
        extend_feature_key(&env, &FeatureKey::ProtocolFee, RECOVERY_TIMELOCK_SECONDS);
        env.events().publish(
            (Symbol::new(&env, "protocol_fee_set"), caller),
            (fee_bps, treasury),
        );
    }

    pub fn get_protocol_fee(env: Env) -> Option<ProtocolFeeConfig> {
        load_protocol_fee(&env)
    }

    // ------------------------------------------------------------------------
    // #225: MILESTONE ESCROW WITH DISPUTE ARBITER
    // ------------------------------------------------------------------------

    /// Fund a milestone-based escrow. The employer deposits `total_amount`
    /// up front; individual milestones are released only on approval.
    pub fn create_milestone_escrow(
        env: Env,
        employer: Address,
        contractor: Address,
        arbiter: Address,
        token: Address,
        total_amount: i128,
        milestone_amounts: Vec<i128>,
    ) -> u64 {
        employer.require_auth();
        assert!(total_amount > 0, "total_amount must be positive");
        assert!(
            !milestone_amounts.is_empty(),
            "milestone_amounts must not be empty"
        );
        assert!(
            milestone_amounts.len() <= MAX_MILESTONE_ESCROW_STAGES,
            "too many milestones"
        );
        let mut milestone_total: i128 = 0;
        for amount in milestone_amounts.iter() {
            assert!(amount > 0, "milestone amount must be positive");
            milestone_total = milestone_total
                .checked_add(amount)
                .expect("Milestone total overflow");
        }
        if milestone_total > total_amount {
            panic_with_error!(&env, OrbitContractError::InvalidMilestoneEscrow);
        }

        let key = DataKey::NextMilestoneEscrowId;
        let id: u64 = env.storage().instance().get(&key).unwrap_or(0);
        env.storage().instance().set(
            &key,
            &id.checked_add(1).expect("Milestone escrow id exhausted"),
        );

        let mut released = Vec::new(&env);
        for _ in milestone_amounts.iter() {
            released.push_back(false);
        }
        let escrow = MilestoneEscrow {
            id,
            employer: employer.clone(),
            contractor: contractor.clone(),
            arbiter: arbiter.clone(),
            token: token.clone(),
            total_amount,
            milestone_amounts,
            released,
            released_amount: 0,
            status: MilestoneEscrowStatus::Pending,
        };
        token::Client::new(&env, &token).transfer(
            &employer,
            env.current_contract_address(),
            &total_amount,
        );
        save_milestone_escrow(&env, &escrow);
        env.events().publish(
            (Symbol::new(&env, "milestone_escrow_created"), id),
            (employer, contractor, arbiter, total_amount),
        );
        id
    }

    /// Release one approved milestone's payout to the contractor.
    pub fn approve_milestone(env: Env, employer: Address, escrow_id: u64, milestone_index: u32) {
        employer.require_auth();
        let mut escrow = load_milestone_escrow(&env, escrow_id);
        if escrow.employer != employer {
            panic_with_error!(&env, OrbitContractError::InvalidMilestoneEscrow);
        }
        assert!(
            milestone_index < escrow.milestone_amounts.len(),
            "milestone_index out of bounds"
        );
        if escrow.status == MilestoneEscrowStatus::Disputed
            || escrow.status == MilestoneEscrowStatus::Refunded
            || escrow.status == MilestoneEscrowStatus::SettledMutual
            || escrow.released.get(milestone_index) == Some(true)
        {
            panic_with_error!(&env, OrbitContractError::MilestoneAlreadyReleased);
        }
        let amount = escrow
            .milestone_amounts
            .get(milestone_index)
            .expect("Milestone amount missing");
        token::Client::new(&env, &escrow.token).transfer(
            &env.current_contract_address(),
            &escrow.contractor,
            &amount,
        );
        escrow.released.set(milestone_index, true);
        escrow.released_amount = escrow
            .released_amount
            .checked_add(amount)
            .expect("Released total overflow");
        escrow.status = MilestoneEscrowStatus::Approved;
        save_milestone_escrow(&env, &escrow);
        env.events().publish(
            (
                Symbol::new(&env, "milestone_approved"),
                escrow_id,
                milestone_index,
            ),
            (escrow.contractor.clone(), amount),
        );
    }

    /// Either escrow party may escalate to the designated arbiter.
    /// Initiating a dispute requires depositing a dispute bond (5% of remaining escrow amount, min 1).
    pub fn dispute_milestone_escrow(env: Env, caller: Address, escrow_id: u64) {
        caller.require_auth();
        let mut escrow = load_milestone_escrow(&env, escrow_id);
        assert!(
            caller == escrow.employer || caller == escrow.contractor,
            "Only escrow parties may raise a dispute"
        );
        assert!(
            escrow.status != MilestoneEscrowStatus::Refunded
                && escrow.status != MilestoneEscrowStatus::SettledMutual,
            "Escrow already finalized"
        );
        assert!(
            escrow.status != MilestoneEscrowStatus::Disputed,
            "Escrow already disputed"
        );

        let remaining = escrow
            .total_amount
            .checked_sub(escrow.released_amount)
            .expect("Released exceeds total amount");

        // 5% dispute bond requirement (min 1)
        let bond_amount = (remaining * 5 / 100).max(1);

        // Custody bond from claimant to contract
        token::Client::new(&env, &escrow.token).transfer(
            &caller,
            &env.current_contract_address(),
            &bond_amount,
        );

        // Store bond record
        let bond_key = DataKey::MilestoneDisputeBond(escrow_id);
        env.storage().persistent().set(
            &bond_key,
            &DisputeBondRecord {
                claimant: caller.clone(),
                amount: bond_amount,
            },
        );

        escrow.status = MilestoneEscrowStatus::Disputed;
        save_milestone_escrow(&env, &escrow);
        env.events().publish(
            (Symbol::new(&env, "milestone_disputed"), escrow_id, caller),
            bond_amount,
        );
    }

    /// Arbiter-only resolution. The two splits must equal the still-escrowed
    /// balance, so no tokens can be created or silently stranded.
    /// Legitimate disputes (frivolous = false) refund the staked bond to the claimant.
    /// Frivolous disputes (frivolous = true) forfeit the bond to the counterparty (respondent).
    pub fn resolve_dispute_with_ruling(
        env: Env,
        arbiter: Address,
        escrow_id: u64,
        employer_split: i128,
        contractor_split: i128,
        frivolous: bool,
    ) {
        arbiter.require_auth();
        let mut escrow = load_milestone_escrow(&env, escrow_id);
        if escrow.arbiter != arbiter {
            panic_with_error!(&env, OrbitContractError::InvalidMilestoneEscrow);
        }
        if escrow.status != MilestoneEscrowStatus::Disputed {
            panic_with_error!(&env, OrbitContractError::MilestoneNotDisputed);
        }
        assert!(
            employer_split >= 0 && contractor_split >= 0,
            "Dispute splits must be non-negative"
        );
        let remaining = escrow
            .total_amount
            .checked_sub(escrow.released_amount)
            .expect("Released exceeds deposited amount");
        let split_total = employer_split
            .checked_add(contractor_split)
            .expect("Dispute split overflow");
        if split_total != remaining {
            panic_with_error!(&env, OrbitContractError::InvalidDisputeSplit);
        }
        let contract = env.current_contract_address();
        let token_client = token::Client::new(&env, &escrow.token);

        if employer_split > 0 {
            token_client.transfer(
                &contract,
                &escrow.employer,
                &employer_split,
            );
        }
        if contractor_split > 0 {
            token_client.transfer(
                &contract,
                &escrow.contractor,
                &contractor_split,
            );
        }

        // Adjudicate dispute bond if one was staked (#373)
        let bond_key = DataKey::MilestoneDisputeBond(escrow_id);
        if let Some(bond) = env.storage().persistent().get::<_, DisputeBondRecord>(&bond_key) {
            env.storage().persistent().remove(&bond_key);
            if frivolous {
                // Forfeit bond to counterparty (respondent)
                let respondent = if bond.claimant == escrow.employer {
                    escrow.contractor.clone()
                } else {
                    escrow.employer.clone()
                };
                token_client.transfer(&contract, &respondent, &bond.amount);
            } else {
                // Legitimate dispute: refund bond to claimant
                token_client.transfer(&contract, &bond.claimant, &bond.amount);
            }
            env.events().publish(
                (Symbol::new(&env, "dispute_bond_settled"), escrow_id, bond.claimant),
                (bond.amount, frivolous),
            );
        }

        escrow.released_amount = escrow.total_amount;
        escrow.status = MilestoneEscrowStatus::Refunded;
        save_milestone_escrow(&env, &escrow);
        env.events().publish(
            (Symbol::new(&env, "milestone_dispute_resolved"), escrow_id),
            (employer_split, contractor_split),
        );
    }

    /// Preserves existing signature for resolve_dispute defaulting to legitimate resolution.
    pub fn resolve_dispute(
        env: Env,
        arbiter: Address,
        escrow_id: u64,
        employer_split: i128,
        contractor_split: i128,
    ) {
        let mut escrow = load_milestone_escrow(&env, escrow_id);
        escrow.employer.require_auth();
        escrow.contractor.require_auth();

        assert!(
            escrow.status != MilestoneEscrowStatus::Refunded
                && escrow.status != MilestoneEscrowStatus::SettledMutual,
            "Escrow already finalized"
        );
        assert!(
            employer_split >= 0 && contractor_split >= 0,
            "Settlement splits must be non-negative"
        );
        let remaining = escrow
            .total_amount
            .checked_sub(escrow.released_amount)
            .expect("Released exceeds deposited amount");
        let split_total = employer_split
            .checked_add(contractor_split)
            .expect("Settlement split overflow");
        if split_total != remaining {
            panic_with_error!(&env, OrbitContractError::InvalidDisputeSplit);
        }
        let contract = env.current_contract_address();
        if employer_split > 0 {
            token::Client::new(&env, &escrow.token).transfer(
                &contract,
                &escrow.employer,
                &employer_split,
            );
        }
        if contractor_split > 0 {
            token::Client::new(&env, &escrow.token).transfer(
                &contract,
                &escrow.contractor,
                &contractor_split,
            );
        }
        escrow.released_amount = escrow.total_amount;
        escrow.status = MilestoneEscrowStatus::SettledMutual;
        save_milestone_escrow(&env, &escrow);
        env.events().publish(
            (Symbol::new(&env, "mutual_escrow_settled"), escrow_id),
            (employer_split, contractor_split),
        );
    }

        Self::resolve_dispute_with_ruling(
            env,
            arbiter,
            escrow_id,
            employer_split,
            contractor_split,
            false,
        );
    }

    pub fn get_milestone_dispute_bond(env: Env, escrow_id: u64) -> Option<DisputeBondRecord> {
        let bond_key = DataKey::MilestoneDisputeBond(escrow_id);
        env.storage().persistent().get(&bond_key)
    }

    pub fn get_milestone_escrow(env: Env, escrow_id: u64) -> Option<MilestoneEscrow> {
        env.storage()
            .persistent()
            .get(&DataKey::MilestoneEscrow(escrow_id))
    }

    // ------------------------------------------------------------------------
    // #226: SLIDING-WINDOW RATE LIMITS
    // ------------------------------------------------------------------------

    /// Configure a per-vault rolling window. Reconfiguring starts a fresh
    /// window, so no new vault transaction is needed after a window expires.
    pub fn configure_vault_rate_limit(
        env: Env,
        user: Address,
        merchant: Address,
        window_duration_ledgers: u32,
        max_cumulative_amount: i128,
    ) {
        user.require_auth();
        assert!(
            window_duration_ledgers > 0,
            "window_duration_ledgers must be positive"
        );
        assert!(
            max_cumulative_amount > 0,
            "max_cumulative_amount must be positive"
        );
        let key = rate_limit_key(&user, &merchant);
        let mut limit = env
            .storage()
            .persistent()
            .get::<_, VaultRateLimit>(&key)
            .unwrap_or(VaultRateLimit {
                window_duration_ledgers,
                max_cumulative_amount,
                window_start_ledger: 0,
                window_spent: 0,
            });
        limit.window_duration_ledgers = window_duration_ledgers;
        limit.max_cumulative_amount = max_cumulative_amount;
        limit.window_start_ledger = env.ledger().sequence();
        limit.window_spent = 0;
        env.storage().persistent().set(&key, &limit);
        extend_feature_key(
            &env,
            &key,
            u64::from(window_duration_ledgers) * SECONDS_PER_LEDGER,
        );
        env.events().publish(
            (
                Symbol::new(&env, "vault_rate_limit_configured"),
                user,
                merchant,
            ),
            (window_duration_ledgers, max_cumulative_amount),
        );
    }

    pub fn get_vault_rate_limit(
        env: Env,
        user: Address,
        merchant: Address,
    ) -> Option<VaultRateLimit> {
        env.storage()
            .persistent()
            .get(&rate_limit_key(&user, &merchant))
    }
}

// ----------------------------------------------------------------------------
// LOYALTY DISCOUNT & META-TRANSACTION HELPERS (#180, #207)
// ----------------------------------------------------------------------------

/// Best discount in basis points the user's active loyalty stake earns from the
/// merchant's configured tiers. Zero when unqualified.
fn loyalty_discount_bps(env: &Env, user: &Address, merchant: &Address) -> u32 {
    let stake: Option<LoyaltyStake> = env
        .storage()
        .persistent()
        .get(&DataKey::LoyaltyStake(user.clone()));
    let stake = match stake {
        Some(s) => s,
        None => return 0,
    };
    let tiers: Option<Vec<LoyaltyTier>> = env
        .storage()
        .persistent()
        .get(&FeatureKey::LoyaltyTiers(merchant.clone()));
    let mut best = 0u32;
    if let Some(tiers) = tiers {
        for tier in tiers.iter() {
            if stake.amount >= tier.min_lock_amount && tier.discount_bps > best {
                best = tier.discount_bps;
            }
        }
    }
    best
}

fn load_user_nonce(env: &Env, user: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&FeatureKey::UserNonce(user.clone()))
        .unwrap_or(0)
}

/// Consumes the nonce so a signature can never be replayed.
fn bump_user_nonce(env: &Env, user: &Address, current: u64) {
    let key = FeatureKey::UserNonce(user.clone());
    let next = current.checked_add(1).expect("Nonce overflow");
    env.storage().persistent().set(&key, &next);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, MIN_TTL_LEDGERS);
}

/// `SHA256(contract_address || chain_id || nonce || function_symbol || parameters || deadline)`.
fn meta_digest(
    env: &Env,
    function_symbol: &str,
    params: &Bytes,
    nonce: u64,
    deadline: u64,
) -> BytesN<32> {
    use soroban_sdk::xdr::ToXdr;
    let mut data = env.current_contract_address().to_xdr(env);
    data.append(&Bytes::from_array(
        env,
        &env.ledger().network_id().to_array(),
    ));
    data.extend_from_array(&nonce.to_be_bytes());
    data.append(&Symbol::new(env, function_symbol).to_xdr(env));
    data.append(params);
    data.extend_from_array(&deadline.to_be_bytes());
    env.crypto().sha256(&data).to_bytes()
}

/// Digest for `create_vault_with_signature` (#207). Public so relayer tests can
/// build the message the subscriber must sign.
pub fn create_vault_meta_digest(
    env: &Env,
    user: &Address,
    merchant: &Address,
    token: &Address,
    amount_per_interval: i128,
    interval_seconds: u64,
    nonce: u64,
    deadline: u64,
) -> BytesN<32> {
    use soroban_sdk::xdr::ToXdr;
    let mut params = user.clone().to_xdr(env);
    params.append(&merchant.clone().to_xdr(env));
    params.append(&token.clone().to_xdr(env));
    params.extend_from_array(&amount_per_interval.to_be_bytes());
    params.extend_from_array(&interval_seconds.to_be_bytes());
    meta_digest(env, "create_vault", &params, nonce, deadline)
}

/// Digest for `cancel_vault_with_signature` (#207).
pub fn cancel_vault_meta_digest(
    env: &Env,
    user: &Address,
    merchant: &Address,
    nonce: u64,
    deadline: u64,
) -> BytesN<32> {
    use soroban_sdk::xdr::ToXdr;
    let mut params = user.clone().to_xdr(env);
    params.append(&merchant.clone().to_xdr(env));
    meta_digest(env, "cancel_vault", &params, nonce, deadline)
}

/// Message a subscriber signs for `create_vault_delegated` (#296):
/// `SHA256(contract_address || network_id || "create_vault_delegated" || XDR(authorization))`.
///
/// The contract address and network id bind the signature to this deployment
/// and network; the function symbol keeps it from verifying as any other
/// signed message. Public so relayers and tests build the exact same bytes.
pub fn delegated_vault_digest(
    env: &Env,
    authorization: &DelegatedVaultAuthorization,
) -> BytesN<32> {
    use soroban_sdk::xdr::ToXdr;
    let mut data = env.current_contract_address().to_xdr(env);
    data.append(&Bytes::from_array(
        env,
        &env.ledger().network_id().to_array(),
    ));
    data.append(&Symbol::new(env, "create_vault_delegated").to_xdr(env));
    data.append(&authorization.clone().to_xdr(env));
    env.crypto().sha256(&data).to_bytes()
}

pub fn delegated_batch_disburse_digest(
    env: &Env,
    sender: &Address,
    token: &Address,
    nonce: u64,
    deadline_ledger: u32,
    splits: &Vec<PaymentSplit>,
) -> BytesN<32> {
    use soroban_sdk::xdr::ToXdr;
    let mut params = sender.clone().to_xdr(env);
    params.append(&token.clone().to_xdr(env));
    for split in splits.iter() {
        params.append(&split.to_xdr(env));
    }
    meta_digest(
        env,
        "batch_disburse_delegated",
        &params,
        nonce,
        u64::from(deadline_ledger),
    )
}

/// Structured message digest for multi-sig batch disbursement (#345).
/// Hashes batch_id, sender_vault, token, splits, nonce, and expiration_ledger.
pub fn multisig_batch_disburse_digest(
    env: &Env,
    batch_id: u64,
    sender_vault: &Address,
    token: &Address,
    splits: &Vec<PaymentSplit>,
    nonce: u64,
    expiration_ledger: u32,
) -> BytesN<32> {
    use soroban_sdk::xdr::ToXdr;
    let mut params = batch_id.to_xdr(env);
    params.append(&sender_vault.clone().to_xdr(env));
    params.append(&token.clone().to_xdr(env));
    for split in splits.iter() {
        params.append(&split.to_xdr(env));
    }
    meta_digest(
        env,
        "batch_disburse_multisig",
        &params,
        nonce,
        u64::from(expiration_ledger),
    )
}

pub fn batch_disburse_multisig_digest(
    env: &Env,
    batch_id: u64,
    sender_vault: &Address,
    token: &Address,
    splits: &Vec<PaymentSplit>,
    nonce: u64,
    expiration_ledger: u32,
) -> BytesN<32> {
    multisig_batch_disburse_digest(
        env,
        batch_id,
        sender_vault,
        token,
        splits,
        nonce,
        expiration_ledger,
    )
}

/// Domain-separated digest for multi-subscriber delegated vault creation (#379).
/// Unlike the single-vault digest it binds the signature specifically to the
/// batch entrypoint. It also binds the contract and network to prevent replay
/// on a different deployment or network. The signature itself is excluded.
pub fn delegated_batch_vault_digest(
    env: &Env,
    authorization: &DelegatedVaultAuth,
) -> BytesN<32> {
    use soroban_sdk::xdr::ToXdr;
    let mut data = env.current_contract_address().to_xdr(env);
    data.append(&Bytes::from_array(
        env,
        &env.ledger().network_id().to_array(),
    ));
    data.append(&Symbol::new(env, "batch_create_vaults_delegated").to_xdr(env));
    data.append(&authorization.user.clone().to_xdr(env));
    data.append(&authorization.merchant.clone().to_xdr(env));
    data.append(&authorization.token.clone().to_xdr(env));
    data.extend_from_array(&authorization.amount.to_be_bytes());
    data.extend_from_array(&authorization.interval_ledgers.to_be_bytes());
    data.extend_from_array(&authorization.nonce.to_be_bytes());
    data.extend_from_array(&authorization.expiry_ledger.to_be_bytes());
    env.crypto().sha256(&data).to_bytes()
}

/// The Ed25519 key behind an account (`G...`) address, or `None` for any
/// other address kind (e.g. a contract), which cannot sign with Ed25519.
fn ed25519_account_key(env: &Env, user: &Address) -> Option<BytesN<32>> {
    use soroban_sdk::xdr::ToXdr;
    // ScVal::Address XDR: 4-byte discriminant, 4-byte address type, 4-byte
    // key type, then the 32-byte Ed25519 public key for account addresses.
    let xdr = user.clone().to_xdr(env);
    if xdr.len() < 44 {
        return None;
    }
    let addr_type: BytesN<4> = xdr.slice(4..8).try_into().ok()?;
    if addr_type.to_array() != [0, 0, 0, 0] {
        return None;
    }
    xdr.slice(12..44).try_into().ok()
}

/// Extracts the Ed25519 master key from an account (`G...`) user address.
fn account_ed25519_key(env: &Env, user: &Address) -> BytesN<32> {
    ed25519_account_key(env, user).expect("User must be an account address")
}

fn verify_meta_signature(env: &Env, user: &Address, digest: &BytesN<32>, signature: &BytesN<64>) {
    let pubkey = account_ed25519_key(env, user);
    env.crypto().ed25519_verify(
        &pubkey,
        &Bytes::from_array(env, &digest.to_array()),
        signature,
    );
}

/// Checks every split upfront so a bad entry fails before any transfer. Returns the total.
fn validate_splits(splits: &Vec<PaymentSplit>) -> i128 {
    assert!(!splits.is_empty(), "splits must not be empty");

    let mut total_amount: i128 = 0;
    for split in splits.iter() {
        assert!(split.amount > 0, "split amount must be positive");
        total_amount = total_amount
            .checked_add(split.amount)
            .expect("Total amount overflow");
    }
    total_amount
}

/// Aggregates required amounts per unique token contract, in first-appearance
/// order so the summary event is deterministic.
fn payroll_totals(env: &Env, splits: &Vec<PaymentSplit>) -> Vec<(Address, i128)> {
    let mut totals: Vec<(Address, i128)> = Vec::new(env);
    for split in splits.iter() {
        let mut index = None;
        for (position, entry) in totals.iter().enumerate() {
            if entry.0 == split.token {
                index = Some(position);
                break;
            }
        }
        match index {
            Some(position) => {
                let entry = totals.get(position as u32).expect("Token total missing");
                let total = entry
                    .1
                    .checked_add(split.amount)
                    .expect("Payroll token total overflow");
                let mut rebuilt = Vec::new(env);
                for (current, item) in totals.iter().enumerate() {
                    if current == position {
                        rebuilt.push_back((item.0, total));
                    } else {
                        rebuilt.push_back(item);
                    }
                }
                totals = rebuilt;
            }
            None => totals.push_back((split.token.clone(), split.amount)),
        }
    }
    totals
}

/// Verifies that the sender has approved enough of every distinct token used by
/// the batch before any transfer is executed (#301).
fn verify_payroll_allowances(env: &Env, sender: &Address, splits: &Vec<PaymentSplit>) {
    let contract = env.current_contract_address();
    for (token, required) in payroll_totals(env, splits).iter() {
        let allowance = token::Client::new(env, &token).allowance(sender, &contract);
        assert!(
            allowance >= required,
            "Insufficient allowance for payroll token"
        );
    }
}

/// Transfers each split in its own token contract. Atomicity is provided by
/// Soroban: a failed transfer reverts every earlier transfer in the batch.
fn disburse(env: &Env, sender: &Address, splits: Vec<PaymentSplit>) {
    for split in splits.into_iter() {
        token::Client::new(env, &split.token).transfer_from(
            &env.current_contract_address(),
            sender,
            &split.recipient,
            &split.amount,
        );
    }
}

fn load_proposal(env: &Env, proposal_id: u64) -> PayrollProposal {
    env.storage()
        .persistent()
        .get(&DataKey::Proposal(proposal_id))
        .expect("Proposal does not exist")
}

fn load_payroll_escrow(env: &Env, payroll_id: u64) -> PayrollEscrow {
    env.storage()
        .persistent()
        .get(&DataKey::PayrollEscrow(payroll_id))
        .expect("Payroll escrow does not exist")
}

/// Persists a payroll escrow and keeps it alive until its expiration (plus the
/// standard margin), so a recipient can still claim right up to the deadline.
fn save_payroll_escrow(env: &Env, escrow: &PayrollEscrow) {
    let key = DataKey::PayrollEscrow(escrow.id);
    env.storage().persistent().set(&key, escrow);
    let remaining = escrow
        .expiration_timestamp
        .saturating_sub(env.ledger().timestamp());
    let (threshold, extend_to) = calculate_ttl_params(remaining);
    env.storage()
        .persistent()
        .extend_ttl(&key, threshold, extend_to);
}

fn load_merkle_payroll(env: &Env, claim_id: u64) -> MerklePayrollData {
    env.storage()
        .persistent()
        .get(&DataKey::MerklePayroll(claim_id))
        .expect("Merkle payroll does not exist")
}

/// Persists a Merkle payroll and keeps it alive until its claim window closes.
fn save_merkle_payroll(env: &Env, claim_id: u64, payroll: &MerklePayrollData) {
    let key = DataKey::MerklePayroll(claim_id);
    env.storage().persistent().set(&key, payroll);
    let remaining = payroll
        .expiration_timestamp
        .saturating_sub(env.ledger().timestamp());
    let (threshold, extend_to) = calculate_ttl_params(remaining);
    env.storage()
        .persistent()
        .extend_ttl(&key, threshold, extend_to);
}

/// Canonical reward leaf preimage: domain tag, then the length-prefixed
/// Address XDR, then the amount as 16 big-endian bytes. Length-prefixing makes
/// the encoding unambiguous and keeps leaves distinct from 64-byte inner nodes.
pub fn reward_leaf(env: &Env, claimant: &Address, amount: i128) -> BytesN<32> {
    use soroban_sdk::xdr::ToXdr;
    let mut data = Bytes::from_slice(env, REWARD_LEAF_DOMAIN);
    let address = claimant.clone().to_xdr(env);
    data.extend_from_array(&address.len().to_be_bytes());
    data.append(&address);
    data.extend_from_array(&amount.to_be_bytes());
    env.crypto().sha256(&data).to_bytes()
}

/// Merkle payroll leaf: `SHA256(recipient_xdr || amount as 16 big-endian bytes)`.
/// The XDR address encoding is never 64 bytes long, so a leaf preimage can't be
/// mistaken for an inner node (`left || right`).
pub fn merkle_leaf(env: &Env, recipient: &Address, amount: i128) -> BytesN<32> {
    use soroban_sdk::xdr::ToXdr;
    let mut data = recipient.clone().to_xdr(env);
    data.extend_from_array(&amount.to_be_bytes());
    env.crypto().sha256(&data).to_bytes()
}

/// Inner Merkle node: SHA256 of the two children in ascending byte order, so a
/// proof only needs the sibling hashes and not their left/right positions.
pub fn merkle_hash_pair(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    let (first, second) = if a.to_array() <= b.to_array() {
        (a, b)
    } else {
        (b, a)
    };
    let mut data = Bytes::from_array(env, &first.to_array());
    data.extend_from_array(&second.to_array());
    env.crypto().sha256(&data).to_bytes()
}

fn verify_merkle_proof(
    env: &Env,
    proof: &Vec<BytesN<32>>,
    root: &BytesN<32>,
    leaf: &BytesN<32>,
) -> bool {
    let mut computed = leaf.clone();
    for sibling in proof.iter() {
        computed = merkle_hash_pair(env, &computed, &sibling);
    }
    computed == *root
}

fn save_proposal(env: &Env, proposal: &PayrollProposal) {
    let key = DataKey::Proposal(proposal.id);
    env.storage().persistent().set(&key, proposal);
    // Keep pending and executed proposals live; executed ones are kept for replay protection
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, MIN_TTL_LEDGERS);
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD_LEDGERS, MIN_TTL_LEDGERS);
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod test_fuzz;

#[cfg(test)]
mod test_storage;

#[cfg(test)]
mod test_batch_pause;

#[cfg(test)]
mod test_upgrade;

#[cfg(test)]
mod test_revenue_splits_batch;
mod test_issues_223_226;

#[cfg(test)]
mod test_batch_cancel;

#[cfg(test)]
mod test_delegated_batch;
