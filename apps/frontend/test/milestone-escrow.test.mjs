import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateContractorAddress,
  validateMilestoneAmount,
  validateProjectInput,
  createMilestoneProject,
  submitMilestoneDeliverable,
  requestMilestoneChanges,
  approveAndReleaseMilestone,
  calculateProjectStats,
  SAMPLE_MILESTONE_PROJECTS,
} from '../src/lib/milestone-escrow.ts';

const VALID_CONTRACTOR_1 = "GD3AGJRMLRKRTQKBVMLT6AW34IZZ3IEALRHTY247BBNISVS452SMQDPG";
const VALID_CONTRACTOR_2 = "GBXCR3C3CEKQ3UYNA3UUN2BUBB3GOGWN4VPR2FJ2G2WFQJLFVKJXDJ3A";
const INVALID_CONTRACTOR = "GBXCR3C3CEKQ3UYNA3UUN2BUBB3GOGWN4VPR2FJ2G2WFQJLFVKJXXXXX";

test('milestone escrow: contractor address validation enforces strict Ed25519 public key checks', () => {
  assert.equal(validateContractorAddress(VALID_CONTRACTOR_1), true);
  assert.equal(validateContractorAddress(VALID_CONTRACTOR_2), true);
  assert.equal(validateContractorAddress(INVALID_CONTRACTOR), false);
  assert.equal(validateContractorAddress(''), false);
  assert.equal(validateContractorAddress('0x1234567890abcdef'), false);
  assert.equal(validateContractorAddress('not-an-address'), false);
});

test('milestone escrow: amount parser validates positive USDC amounts with max 7 decimals and rejects invalid precision or negative amounts', () => {
  assert.equal(validateMilestoneAmount(500), 500);
  assert.equal(validateMilestoneAmount('150.50'), 150.50);
  assert.equal(validateMilestoneAmount('0.0000001'), 0.0000001);
  assert.equal(validateMilestoneAmount('0'), null);
  assert.equal(validateMilestoneAmount('-50'), null);
  assert.equal(validateMilestoneAmount('invalid'), null);
  assert.equal(validateMilestoneAmount('0.00000001'), null); // > 7 decimal places
});

test('milestone escrow: project builder validation catches incomplete inputs and invalid stages', () => {
  const invalidInput = {
    title: '',
    contractorName: '',
    contractorAddress: INVALID_CONTRACTOR,
    stages: [],
  };
  const result = validateProjectInput(invalidInput);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 3);

  const invalidStageInput = {
    title: 'Orbit DAO Payroll',
    contractorName: 'Sarah Lin',
    contractorAddress: VALID_CONTRACTOR_1,
    stages: [
      { title: '', amount: '0', dueDate: '' },
    ],
  };
  const stageResult = validateProjectInput(invalidStageInput);
  assert.equal(stageResult.valid, false);
  assert.ok(stageResult.errors.some(e => e.includes('Title is required')));
  assert.ok(stageResult.errors.some(e => e.includes('Amount must be a positive number')));
  assert.ok(stageResult.errors.some(e => e.includes('Due date is required')));
});

test('milestone escrow: project creation builds multi-stage agreement with correct totals and pending statuses', () => {
  const input = {
    title: 'Soroban Escrow Protocol Integration',
    contractorName: 'Charlie Vance',
    contractorAddress: VALID_CONTRACTOR_1,
    stages: [
      {
        title: 'Stage 1: Architecture Review',
        amount: 800.0,
        dueDate: '2026-11-01',
        description: 'Threat model review for multi-sig release gates',
      },
      {
        title: 'Stage 2: Implementation & Property Testing',
        amount: 1200.0,
        dueDate: '2026-11-15',
        description: 'Rust Soroban contract implementation with fuzz testing',
      },
    ],
  };

  const project = createMilestoneProject(input);
  assert.equal(project.title, input.title);
  assert.equal(project.contractorName, input.contractorName);
  assert.equal(project.contractorAddress, input.contractorAddress);
  assert.equal(project.totalAmount, 2000.0);
  assert.equal(project.releasedAmount, 0.0);
  assert.equal(project.status, 'active');
  assert.equal(project.milestones.length, 2);
  assert.equal(project.milestones[0].status, 'pending');
  assert.equal(project.milestones[1].status, 'pending');
  assert.equal(project.milestones[0].order, 1);
  assert.equal(project.milestones[1].order, 2);

  const stats = calculateProjectStats(project);
  assert.equal(stats.totalUsdc, 2000.0);
  assert.equal(stats.releasedUsdc, 0.0);
  assert.equal(stats.pendingUsdc, 2000.0);
  assert.equal(stats.progressPercent, 0);
  assert.equal(stats.completedStages, 0);
  assert.equal(stats.totalStages, 2);
});

test('milestone escrow: contractor deliverable submission transitions pending to submitted with proof link', () => {
  const project = createMilestoneProject({
    title: 'Mobile Widget Handover',
    contractorName: 'Sarah Lin',
    contractorAddress: VALID_CONTRACTOR_2,
    stages: [
      { title: 'Stage 1: QR Bridge', amount: 500, dueDate: '2026-11-05' },
    ],
  });

  const targetId = project.milestones[0].id;
  const proofUrl = 'https://github.com/Orbit-xyz/Orbit/pull/216';
  const notes = 'Implemented universal QR fallback with 5-minute session countdown';

  const updated = submitMilestoneDeliverable(project, targetId, proofUrl, notes);
  const updatedMs = updated.milestones[0];

  assert.equal(updatedMs.status, 'submitted');
  assert.equal(updatedMs.deliverableUrl, proofUrl);
  assert.equal(updatedMs.submissionNotes, notes);
  assert.ok(updatedMs.submittedAt);

  // Negative: invalid URL or empty proof link fails
  assert.throws(() => {
    submitMilestoneDeliverable(project, targetId, 'not-a-valid-url');
  }, /must be a valid URL/);

  assert.throws(() => {
    submitMilestoneDeliverable(project, 'non_existent_id', proofUrl);
  }, /not found/);
});

test('milestone escrow: merchant review can request changes, keeping funds locked with feedback reason', () => {
  const project = createMilestoneProject({
    title: 'Security Audit',
    contractorName: 'Charlie Vance',
    contractorAddress: VALID_CONTRACTOR_1,
    stages: [
      { title: 'Stage 1: Threat Model', amount: 600, dueDate: '2026-11-01' },
    ],
  });

  const targetId = project.milestones[0].id;
  const submitted = submitMilestoneDeliverable(project, targetId, 'https://github.com/Orbit-xyz/Orbit/pull/188');

  const feedback = 'Please add formal invariants asserting vault token balance never drops below zero.';
  const reviewed = requestMilestoneChanges(submitted, targetId, feedback);
  const reviewedMs = reviewed.milestones[0];

  assert.equal(reviewedMs.status, 'changes_requested');
  assert.equal(reviewedMs.reviewFeedback, feedback);
  assert.ok(reviewedMs.reviewedAt);
  assert.equal(reviewed.releasedAmount, 0); // funds strictly remain locked

  // Negative: cannot request changes on pending milestone
  assert.throws(() => {
    requestMilestoneChanges(project, targetId, 'Needs fix');
  }, /must be in "submitted" status/);

  // Negative: cannot request changes without feedback
  assert.throws(() => {
    requestMilestoneChanges(submitted, targetId, '   ');
  }, /Feedback is required/);

  // Contractor can re-submit after changes requested
  const resubmitted = submitMilestoneDeliverable(reviewed, targetId, 'https://github.com/Orbit-xyz/Orbit/pull/188/commits/abc', 'Added invariant assertions.');
  assert.equal(resubmitted.milestones[0].status, 'submitted');
});

test('milestone escrow: merchant approval triggers Freighter on-chain release and outputs verified receipt', async () => {
  const project = createMilestoneProject({
    title: 'Payroll Milestone Escrow Tracker',
    contractorName: 'Sarah Lin',
    contractorAddress: VALID_CONTRACTOR_2,
    stages: [
      { title: 'Stage 1: Frontend Milestone Tracker', amount: 750, dueDate: '2026-11-10' },
      { title: 'Stage 2: Freighter Multi-sig Release Gates', amount: 750, dueDate: '2026-11-20' },
    ],
  });

  const stage1Id = project.milestones[0].id;
  const stage2Id = project.milestones[1].id;

  const submitted = submitMilestoneDeliverable(project, stage1Id, 'https://github.com/Orbit-xyz/Orbit/pull/209');

  // Approve & Release Stage 1
  const releaseResult = await approveAndReleaseMilestone(
    submitted,
    stage1Id,
    'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    { mockFreighter: true }
  );

  const updatedProject = releaseResult.project;
  const stage1 = updatedProject.milestones[0];
  const stage2 = updatedProject.milestones[1];

  assert.equal(stage1.status, 'released');
  assert.ok(stage1.txHash);
  assert.ok(stage1.releasedAt);
  assert.equal(stage2.status, 'pending');
  assert.equal(updatedProject.releasedAmount, 750);
  assert.equal(updatedProject.status, 'active');

  // Verified Receipt checks
  assert.ok(releaseResult.receipt);
  assert.equal(releaseResult.receipt.amountUsdc, 750);
  assert.equal(releaseResult.receipt.contractorAddress, VALID_CONTRACTOR_2);
  assert.ok(releaseResult.receipt.txHash.length >= 32);
  assert.ok(releaseResult.receipt.ledgerSequence > 0);
  assert.ok(releaseResult.receipt.explorerUrl.includes('stellar.expert'));

  // Negative: cannot release again (double spend prevention)
  await assert.rejects(async () => {
    await approveAndReleaseMilestone(updatedProject, stage1Id, 'GA5ZSE...');
  }, /funds have already been released/);

  // Negative: cannot release pending milestone without deliverable submission
  await assert.rejects(async () => {
    await approveAndReleaseMilestone(updatedProject, stage2Id, 'GA5ZSE...');
  }, /must be submitted by contractor before approval/);

  // Now submit and approve Stage 2 -> project should transition to completed
  const stage2Submitted = submitMilestoneDeliverable(updatedProject, stage2Id, 'https://github.com/Orbit-xyz/Orbit/pull/209#final');
  const stage2Release = await approveAndReleaseMilestone(
    stage2Submitted,
    stage2Id,
    'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    { mockFreighter: true }
  );

  const finalProject = stage2Release.project;
  assert.equal(finalProject.releasedAmount, 1500);
  assert.equal(finalProject.status, 'completed');

  const finalStats = calculateProjectStats(finalProject);
  assert.equal(finalStats.progressPercent, 100);
  assert.equal(finalStats.pendingUsdc, 0);
  assert.equal(finalStats.completedStages, 2);
});

test('milestone escrow: sample projects data matches schema and demonstrates realistic states', () => {
  assert.ok(SAMPLE_MILESTONE_PROJECTS.length >= 2);
  for (const proj of SAMPLE_MILESTONE_PROJECTS) {
    assert.ok(proj.id);
    assert.ok(proj.title);
    assert.ok(validateContractorAddress(proj.contractorAddress));
    assert.ok(proj.milestones.length > 0);
    const stats = calculateProjectStats(proj);
    assert.equal(stats.totalUsdc, proj.totalAmount);
    assert.equal(stats.releasedUsdc, proj.releasedAmount);
  }
});
