import assert from 'node:assert/strict';
import test from 'node:test';
import { explorerTxUrl, cadenceLabel, buildShareText, xShareUrl, farcasterShareUrl, shortHash } from '../src/receiptCard.js';

test('explorer URL follows network and encodes the hash', () => {
  assert.equal(explorerTxUrl('abc'), 'https://stellar.expert/explorer/testnet/tx/abc');
  assert.equal(explorerTxUrl('abc', true), 'https://stellar.expert/explorer/public/tx/abc');
});

test('cadence labels', () => {
  assert.equal(cadenceLabel(86400), 'Daily');
  assert.equal(cadenceLabel(604800), 'Weekly');
  assert.equal(cadenceLabel(2592000), 'Monthly');
  assert.equal(cadenceLabel(86400 * 14), 'Every 14 days');
  assert.equal(cadenceLabel(undefined), 'Recurring');
});

test('share URLs carry pre-populated text', () => {
  const text = buildShareText('Pro Plan');
  assert.equal(text, 'Just subscribed to Pro Plan on @OrbitNetwork rails!');
  const x = new URL(xShareUrl(text, 'https://orbit.example'));
  assert.equal(x.searchParams.get('text'), text);
  assert.equal(x.searchParams.get('url'), 'https://orbit.example');
  const fc = new URL(farcasterShareUrl(text));
  assert.equal(fc.searchParams.get('text'), text);
});

test('shortHash truncates long hashes only', () => {
  assert.equal(shortHash('a'.repeat(64)), 'aaaaaaaa…aaaaaaaa');
  assert.equal(shortHash('abc'), 'abc');
});
