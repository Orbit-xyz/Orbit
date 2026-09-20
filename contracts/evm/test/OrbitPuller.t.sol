// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OrbitPuller} from "../src/OrbitPuller.sol";

/// @dev Stand-in for USDC on Arc. Six decimals — NOT the seven Soroban's SAC uses.
///      This divergence is the whole point of Build_Guide Task 6.6.
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract OrbitPullerTest is Test {
    OrbitPuller internal orbit;
    MockUSDC internal usdc;

    address internal subscriber = makeAddr("subscriber");
    address internal merchant = makeAddr("merchant");
    address internal attacker = makeAddr("attacker");

    // Mirrors contracts/soroban/src/test.rs, rescaled from 7 to 6 decimals.
    uint256 internal constant STARTING_BALANCE = 100e6; // 100 USDC
    uint256 internal constant PLAN_AMOUNT = 29e6; //  29 USDC
    uint64 internal constant THIRTY_DAYS = 30 days;

    function setUp() public {
        orbit = new OrbitPuller();
        usdc = new MockUSDC();
        usdc.mint(subscriber, STARTING_BALANCE);
    }

    /// @dev The handshake every subscription test starts from.
    function _createVaultAndApprove(uint256 approvalAmount) internal {
        vm.startPrank(subscriber);
        usdc.approve(address(orbit), approvalAmount);
        orbit.createVault(merchant, address(usdc), PLAN_AMOUNT, THIRTY_DAYS);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // THE HANDSHAKE + THE PULL
    // ------------------------------------------------------------------

    /// @dev Direct analogue of Soroban's `test_allowance_handshake_and_pull`.
    function test_CreateVaultAndPull() public {
        _createVaultAndApprove(type(uint256).max);

        vm.prank(merchant);
        orbit.pullFunds(subscriber);

        assertEq(usdc.balanceOf(merchant), PLAN_AMOUNT, "merchant should hold exactly 29 USDC");
        assertEq(usdc.balanceOf(subscriber), STARTING_BALANCE - PLAN_AMOUNT, "subscriber should hold exactly 71 USDC");
    }

    function test_CreateVaultStoresParameters() public {
        _createVaultAndApprove(type(uint256).max);

        OrbitPuller.Vault memory v = orbit.getVault(subscriber, merchant);
        assertEq(v.token, address(usdc));
        assertEq(v.amountPerInterval, PLAN_AMOUNT);
        assertEq(v.intervalSeconds, THIRTY_DAYS);
        assertEq(v.lastPullTimestamp, 0, "a fresh vault has never been pulled");
        assertTrue(v.active);
    }

    /// @dev No funds move during the handshake — the non-custodial invariant.
    function test_CreateVaultMovesNoFunds() public {
        _createVaultAndApprove(type(uint256).max);

        assertEq(usdc.balanceOf(subscriber), STARTING_BALANCE);
        assertEq(usdc.balanceOf(address(orbit)), 0, "OrbitPuller must never custody funds");
    }

    // ------------------------------------------------------------------
    // CADENCE ENFORCEMENT
    // ------------------------------------------------------------------

    function test_RevertWhen_PullTooEarly() public {
        _createVaultAndApprove(type(uint256).max);

        vm.startPrank(merchant);
        orbit.pullFunds(subscriber);

        vm.expectRevert(OrbitPuller.TooEarlyToPull.selector);
        orbit.pullFunds(subscriber);
        vm.stopPrank();

        assertEq(usdc.balanceOf(merchant), PLAN_AMOUNT, "a blocked pull must not move funds");
    }

    function test_PullSucceedsAfterInterval() public {
        _createVaultAndApprove(type(uint256).max);

        vm.prank(merchant);
        orbit.pullFunds(subscriber);

        vm.warp(block.timestamp + THIRTY_DAYS);

        vm.prank(merchant);
        orbit.pullFunds(subscriber);

        assertEq(usdc.balanceOf(merchant), PLAN_AMOUNT * 2, "two cycles settled");
        assertEq(usdc.balanceOf(subscriber), STARTING_BALANCE - (PLAN_AMOUNT * 2));
    }

    /// @dev One second before eligibility the pull must still fail — no off-by-one.
    function test_RevertWhen_PullOneSecondEarly() public {
        _createVaultAndApprove(type(uint256).max);

        vm.prank(merchant);
        orbit.pullFunds(subscriber);

        vm.warp(block.timestamp + THIRTY_DAYS - 1);

        vm.prank(merchant);
        vm.expectRevert(OrbitPuller.TooEarlyToPull.selector);
        orbit.pullFunds(subscriber);
    }

    // ------------------------------------------------------------------
    // AUTHORIZATION & REVOCATION
    // ------------------------------------------------------------------

    /// @dev Only the merchant named in the vault can pull. A third party finds no vault.
    function test_RevertWhen_CallerIsNotMerchant() public {
        _createVaultAndApprove(type(uint256).max);

        vm.prank(attacker);
        vm.expectRevert(OrbitPuller.VaultNotFound.selector);
        orbit.pullFunds(subscriber);
    }

    /// @dev The non-custodial escape hatch: kill the ERC-20 allowance, pulls die.
    function test_RevertWhen_TokenAllowanceRevoked() public {
        _createVaultAndApprove(type(uint256).max);

        vm.prank(subscriber);
        usdc.approve(address(orbit), 0);

        vm.prank(merchant);
        vm.expectRevert();
        orbit.pullFunds(subscriber);

        assertEq(usdc.balanceOf(subscriber), STARTING_BALANCE, "funds stay put");
    }

    function test_RevertWhen_VaultRevoked() public {
        _createVaultAndApprove(type(uint256).max);

        vm.prank(subscriber);
        orbit.revokeVault(merchant);

        vm.prank(merchant);
        vm.expectRevert(OrbitPuller.VaultNotFound.selector);
        orbit.pullFunds(subscriber);
    }

    function test_RevertWhen_RevokingNonexistentVault() public {
        vm.prank(subscriber);
        vm.expectRevert(OrbitPuller.VaultNotFound.selector);
        orbit.revokeVault(merchant);
    }

    /// @dev Insufficient balance must not silently succeed or half-settle.
    function test_RevertWhen_SubscriberBalanceTooLow() public {
        _createVaultAndApprove(type(uint256).max);

        vm.prank(subscriber);
        usdc.transfer(attacker, STARTING_BALANCE); // drain the subscriber

        vm.prank(merchant);
        vm.expectRevert();
        orbit.pullFunds(subscriber);

        assertEq(usdc.balanceOf(merchant), 0);
    }

    // ------------------------------------------------------------------
    // INPUT VALIDATION
    // ------------------------------------------------------------------

    function test_RevertWhen_CreateVaultWithZeroAmount() public {
        vm.prank(subscriber);
        vm.expectRevert(OrbitPuller.InvalidParams.selector);
        orbit.createVault(merchant, address(usdc), 0, THIRTY_DAYS);
    }

    function test_RevertWhen_CreateVaultWithZeroInterval() public {
        vm.prank(subscriber);
        vm.expectRevert(OrbitPuller.InvalidParams.selector);
        orbit.createVault(merchant, address(usdc), PLAN_AMOUNT, 0);
    }

    function test_RevertWhen_CreateVaultWithZeroAddress() public {
        vm.startPrank(subscriber);
        vm.expectRevert(OrbitPuller.InvalidParams.selector);
        orbit.createVault(address(0), address(usdc), PLAN_AMOUNT, THIRTY_DAYS);

        vm.expectRevert(OrbitPuller.InvalidParams.selector);
        orbit.createVault(merchant, address(0), PLAN_AMOUNT, THIRTY_DAYS);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // THE SPLIT (BATCH PAYROLL)
    // ------------------------------------------------------------------

    function test_BatchDisburse() public {
        address dev = makeAddr("frontendDev");
        address eng = makeAddr("contractEngineer");
        address designer = makeAddr("designer");

        address payer = makeAddr("agencyOwner");
        usdc.mint(payer, 1_200e6);

        address[] memory recipients = new address[](3);
        recipients[0] = dev;
        recipients[1] = eng;
        recipients[2] = designer;

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 400e6;
        amounts[1] = 600e6;
        amounts[2] = 200e6;

        vm.startPrank(payer);
        usdc.approve(address(orbit), 1_200e6);
        orbit.batchDisburse(address(usdc), recipients, amounts);
        vm.stopPrank();

        assertEq(usdc.balanceOf(dev), 400e6);
        assertEq(usdc.balanceOf(eng), 600e6);
        assertEq(usdc.balanceOf(designer), 200e6);
        assertEq(usdc.balanceOf(payer), 0, "entire payroll disbursed");
    }

    /// @dev THE headline guarantee: payroll is all-or-nothing. If the last leg cannot
    ///      settle, the earlier recipients must not keep their money either.
    function test_BatchDisburseIsAtomicOnFailure() public {
        address a = makeAddr("contractorA");
        address b = makeAddr("contractorB");
        address c = makeAddr("contractorC");

        address payer = makeAddr("underfundedOwner");
        usdc.mint(payer, 900e6); // 300 short of the 1200 required

        address[] memory recipients = new address[](3);
        recipients[0] = a;
        recipients[1] = b;
        recipients[2] = c;

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 400e6;
        amounts[1] = 500e6;
        amounts[2] = 300e6; // this leg fails

        vm.startPrank(payer);
        usdc.approve(address(orbit), 1_200e6);
        vm.expectRevert();
        orbit.batchDisburse(address(usdc), recipients, amounts);
        vm.stopPrank();

        assertEq(usdc.balanceOf(a), 0, "no partial payroll");
        assertEq(usdc.balanceOf(b), 0, "no partial payroll");
        assertEq(usdc.balanceOf(c), 0, "no partial payroll");
        assertEq(usdc.balanceOf(payer), 900e6, "payer made whole by the revert");
    }

    function test_RevertWhen_BatchLengthMismatch() public {
        address[] memory recipients = new address[](2);
        recipients[0] = makeAddr("r1");
        recipients[1] = makeAddr("r2");

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100e6;

        vm.prank(subscriber);
        vm.expectRevert(OrbitPuller.LengthMismatch.selector);
        orbit.batchDisburse(address(usdc), recipients, amounts);
    }

    /// @dev A blank row in a payroll CSV must fail fast and name itself, not revert
    ///      opaquely inside USDC. Arc forbids transfers to the zero address outright.
    function test_RevertWhen_BatchHasZeroAddressRecipient() public {
        address payer = makeAddr("payer");
        usdc.mint(payer, 500e6);

        address[] memory recipients = new address[](2);
        recipients[0] = makeAddr("goodContractor");
        recipients[1] = address(0); // blank CSV row

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 250e6;
        amounts[1] = 250e6;

        vm.startPrank(payer);
        usdc.approve(address(orbit), 500e6);
        vm.expectRevert(OrbitPuller.InvalidParams.selector);
        orbit.batchDisburse(address(usdc), recipients, amounts);
        vm.stopPrank();

        assertEq(usdc.balanceOf(recipients[0]), 0, "atomic: the good row must not settle either");
        assertEq(usdc.balanceOf(payer), 500e6);
    }

    function test_RevertWhen_BatchTokenIsZeroAddress() public {
        address[] memory recipients = new address[](1);
        recipients[0] = makeAddr("contractor");

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100e6;

        vm.prank(subscriber);
        vm.expectRevert(OrbitPuller.InvalidParams.selector);
        orbit.batchDisburse(address(0), recipients, amounts);
    }

    function test_RevertWhen_BatchIsEmpty() public {
        address[] memory recipients = new address[](0);
        uint256[] memory amounts = new uint256[](0);

        vm.prank(subscriber);
        vm.expectRevert(OrbitPuller.InvalidParams.selector);
        orbit.batchDisburse(address(usdc), recipients, amounts);
    }

    // ------------------------------------------------------------------
    // DASHBOARD VIEWS
    // ------------------------------------------------------------------

    function test_IsPullableLifecycle() public {
        assertFalse(orbit.isPullable(subscriber, merchant), "no vault yet");

        _createVaultAndApprove(type(uint256).max);
        assertTrue(orbit.isPullable(subscriber, merchant), "first pull is immediately due");

        vm.prank(merchant);
        orbit.pullFunds(subscriber);
        assertFalse(orbit.isPullable(subscriber, merchant), "cooling down");

        vm.warp(block.timestamp + THIRTY_DAYS);
        assertTrue(orbit.isPullable(subscriber, merchant), "next cycle due");
    }

    function test_NextPullTimestamp() public {
        _createVaultAndApprove(type(uint256).max);
        assertEq(orbit.nextPullTimestamp(subscriber, merchant), uint64(block.timestamp), "due now");

        vm.prank(merchant);
        orbit.pullFunds(subscriber);

        assertEq(orbit.nextPullTimestamp(subscriber, merchant), uint64(block.timestamp) + THIRTY_DAYS);
    }

    /// @dev Querying a vault that was never created must revert, not return a
    ///      misleading zero that the dashboard would render as "due now".
    function test_RevertWhen_NextPullTimestampOnMissingVault() public {
        vm.expectRevert(OrbitPuller.VaultNotFound.selector);
        orbit.nextPullTimestamp(subscriber, merchant);
    }

    // ------------------------------------------------------------------
    // FUZZ
    // ------------------------------------------------------------------

    /// @dev A pull is eligible if and only if a full interval has elapsed, for any wait.
    function testFuzz_CadenceBoundaryHolds(uint64 waitSeconds) public {
        waitSeconds = uint64(bound(waitSeconds, 0, 365 days));

        _createVaultAndApprove(type(uint256).max);

        vm.prank(merchant);
        orbit.pullFunds(subscriber);

        vm.warp(block.timestamp + waitSeconds);

        bool shouldSucceed = waitSeconds >= THIRTY_DAYS;
        assertEq(orbit.isPullable(subscriber, merchant), shouldSucceed, "view must match execution");

        vm.prank(merchant);
        if (shouldSucceed) {
            orbit.pullFunds(subscriber);
            assertEq(usdc.balanceOf(merchant), PLAN_AMOUNT * 2);
        } else {
            vm.expectRevert(OrbitPuller.TooEarlyToPull.selector);
            orbit.pullFunds(subscriber);
            assertEq(usdc.balanceOf(merchant), PLAN_AMOUNT);
        }
    }

    /// @dev Vaults are keyed by (user, merchant) — they must never bleed into each other.
    function testFuzz_VaultsAreIsolatedPerMerchant(uint256 amountA, uint256 amountB) public {
        amountA = bound(amountA, 1, 1_000e6);
        amountB = bound(amountB, 1, 1_000e6);

        address merchantB = makeAddr("merchantB");

        vm.startPrank(subscriber);
        orbit.createVault(merchant, address(usdc), amountA, THIRTY_DAYS);
        orbit.createVault(merchantB, address(usdc), amountB, THIRTY_DAYS);
        vm.stopPrank();

        assertEq(orbit.getVault(subscriber, merchant).amountPerInterval, amountA);
        assertEq(orbit.getVault(subscriber, merchantB).amountPerInterval, amountB);

        // Revoking one leaves the other untouched.
        vm.prank(subscriber);
        orbit.revokeVault(merchant);

        assertFalse(orbit.getVault(subscriber, merchant).active);
        assertTrue(orbit.getVault(subscriber, merchantB).active);
    }
}
