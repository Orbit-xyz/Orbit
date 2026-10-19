import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  generateChannelId,
  buildHandoverPayloads,
  createHandoverSession,
  renderQRCodeSvg,
  renderQRCodeDataUrl,
  simulateMobileApproval,
  listenHandoverSession,
  HANDOVER_EXPIRY_MS,
} from '../src/mobileHandover.js';

test('Mobile Handover - Session Generation and Expiry Parameters', () => {
  const id1 = generateChannelId();
  const id2 = generateChannelId();

  assert.match(id1, /^orbit_mhandover_/);
  assert.match(id2, /^orbit_mhandover_/);
  assert.notStrictEqual(id1, id2, 'Channel IDs must be unique');

  const session = createHandoverSession({
    planId: 'plan_pro_123',
    planName: 'Pro Tier',
    amount: '490000000',
    merchantAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    merchantName: 'Drips Labs',
  });

  assert.strictEqual(session.status, 'pending');
  assert.strictEqual(session.planId, 'plan_pro_123');
  assert.strictEqual(session.amount, '490000000');
  assert.strictEqual(session.merchantAddress, 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
  assert.strictEqual(session.expiresAt - session.createdAt, HANDOVER_EXPIRY_MS, 'Must expire in exactly 5 minutes');
});

test('Mobile Handover - Deep-link Payloads for Lobstr, Albedo, and WalletConnect', () => {
  const payloads = buildHandoverPayloads({
    channelId: 'orbit_test_channel_xyz',
    planId: 'plan_1',
    planName: 'Basic Plan',
    amount: '10000000',
    merchantAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    apiUrl: 'http://localhost:3001',
    networkPassphrase: 'Test SDF Network ; September 2015',
  });

  // Universal Checkout URI
  assert.ok(payloads.universal.includes('/checkout/mobile?channelId=orbit_test_channel_xyz'));
  assert.ok(payloads.universal.includes('planId=plan_1'));

  // Lobstr Deep Link scheme
  assert.match(payloads.lobstr, /^lobstr:\/\/orbit\/approve/);
  assert.ok(payloads.lobstr.includes('channelId=orbit_test_channel_xyz'));

  // Albedo URI scheme
  assert.match(payloads.albedo, /^https:\/\/albedo\.link\/#tx/);
  assert.ok(payloads.albedo.includes('channelId=orbit_test_channel_xyz'));

  // WalletConnect v2 URI scheme
  assert.match(payloads.walletConnect, /^wc:orbit_test_channel_xyz@2\?relay-protocol=irn/);
});

test('Mobile Handover - QR Code Rendering (SVG & Data URL)', async () => {
  const payload = 'wc:orbit_handover_test@2?relay-protocol=irn';

  const svg = await renderQRCodeSvg(payload);
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<\/svg>/);

  const dataUrl = await renderQRCodeDataUrl(payload);
  assert.match(dataUrl, /^data:image\/png;base64,/);
  assert.ok(dataUrl.length > 200, 'Data URL must contain valid base64 image data');
});

test('Mobile Handover - Real-Time Handshake and Auto-Confirmation', async () => {
  const session = createHandoverSession({
    planId: 'plan_test_handshake',
    amount: '20000000',
    merchantAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  });

  let confirmedResult = null;
  const listener = listenHandoverSession({
    channelId: session.channelId,
    expiresAt: session.expiresAt,
    pollIntervalMs: 50,
    onConfirmed: (confirmation) => {
      confirmedResult = confirmation;
    },
  });

  // Initial state should be pending
  assert.strictEqual(listener.getStatus(), 'pending');

  // Simulate mobile wallet scanning & approving on-chain
  simulateMobileApproval(session.channelId, {
    txHash: 'stellar_tx_hash_12345',
    customerWalletAddress: 'GCXYZTESTCUSTOMERWALLETADDRESS123456789',
    subscriptionId: 'sub_verified_999',
  });

  // Wait for polling step
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.ok(confirmedResult, 'Listener must auto-detect mobile transaction confirmation');
  assert.strictEqual(confirmedResult.txHash, 'stellar_tx_hash_12345');
  assert.strictEqual(confirmedResult.customerWalletAddress, 'GCXYZTESTCUSTOMERWALLETADDRESS123456789');
  assert.strictEqual(confirmedResult.subscriptionId, 'sub_verified_999');

  listener.stop();
});

test('Mobile Handover - HTTP Endpoint Polling Integration', async () => {
  const testChannelId = `http_channel_${Date.now()}`;
  let remoteStatus = 'pending';

  // Setup minimal mock HTTP server
  const server = http.createServer((req, res) => {
    if (req.url === `/handover/sessions/${testChannelId}`) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        session: {
          channel_id: testChannelId,
          status: remoteStatus,
          tx_hash: remoteStatus === 'confirmed' ? 'remote_tx_hash_888' : undefined,
          customer_wallet_address: remoteStatus === 'confirmed' ? 'GCXYZREMOTECUSTOMER' : undefined,
        },
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const mockApiUrl = `http://127.0.0.1:${port}`;

  let scannedTriggered = false;
  let confirmedResult = null;

  const listener = listenHandoverSession({
    channelId: testChannelId,
    apiUrl: mockApiUrl,
    pollIntervalMs: 40,
    onScanned: () => {
      scannedTriggered = true;
    },
    onConfirmed: (confirmation) => {
      confirmedResult = confirmation;
    },
  });

  // Transition to scanned on remote server
  remoteStatus = 'scanned';
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.strictEqual(scannedTriggered, true, 'onScanned callback must fire when remote reports scanned');

  // Transition to confirmed on remote server
  remoteStatus = 'confirmed';
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(confirmedResult, 'onConfirmed callback must fire when remote reports confirmed');
  assert.strictEqual(confirmedResult.txHash, 'remote_tx_hash_888');
  assert.strictEqual(confirmedResult.customerWalletAddress, 'GCXYZREMOTECUSTOMER');

  listener.stop();
  server.close();
});

test('Mobile Handover - Clean 5-Minute Expiration and Cleanup', async () => {
  const channelId = generateChannelId();
  // Set an already-expired timestamp
  const expiredTimestamp = Date.now() - 1000;

  let expiredCalled = false;
  const listener = listenHandoverSession({
    channelId,
    expiresAt: expiredTimestamp,
    pollIntervalMs: 50,
    onExpired: () => {
      expiredCalled = true;
    },
  });

  assert.strictEqual(expiredCalled, true, 'Expired session must immediately trigger onExpired');
  assert.strictEqual(listener.getStatus(), 'expired');

  // Fast-forward session near expiration
  let nearExpiryCalled = false;
  const nearExpiryChannel = generateChannelId();
  const nearExpiryTime = Date.now() + 80;

  const nearListener = listenHandoverSession({
    channelId: nearExpiryChannel,
    expiresAt: nearExpiryTime,
    pollIntervalMs: 20,
    onExpired: () => {
      nearExpiryCalled = true;
    },
  });

  assert.strictEqual(nearListener.getStatus(), 'pending');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.strictEqual(nearExpiryCalled, true, 'Timer must cleanly transition to expired');
  assert.strictEqual(nearListener.getStatus(), 'expired');

  nearListener.stop();
});
