import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BRAND_PROFILE,
  brandProfileFromMerchant,
  brandProfileToPatch,
  contrastRatio,
  evaluateAccentContrast,
  isHttpUrl,
  relativeLuminance,
  validateBrandProfile,
} from '../src/lib/brand-profile.ts';

test('contrast ratio matches WCAG reference values', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  assert.equal(contrastRatio('#777777', '#ffffff'), 4.48);
});

test('relative luminance is 0 for black and 1 for white, and null for invalid colors', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.ok(Math.abs(relativeLuminance('#ffffff') - 1) < 1e-9);
  assert.equal(relativeLuminance('red'), null);
  assert.equal(contrastRatio('#abc', '#ffffff'), null);
});

test('default indigo accent passes WCAG AA for both text pairings', () => {
  const report = evaluateAccentContrast(DEFAULT_BRAND_PROFILE.accentColor);
  assert.equal(report.readable, true);
  assert.deepEqual(report.warnings, []);
  assert.ok(report.whiteOnAccent >= 4.5);
});

test('a pale accent fails the contrast validator and explains why', () => {
  const report = evaluateAccentContrast('#fde68a');
  assert.equal(report.readable, false);
  assert.equal(report.warnings.length, 2);
  assert.match(report.warnings[0], /WCAG AA needs 4.5:1/);
});

test('an invalid accent is flagged rather than scored', () => {
  const report = evaluateAccentContrast('blue');
  assert.equal(report.readable, false);
  assert.equal(report.accentOnWhite, null);
  assert.match(report.warnings[0], /hex color/);
});

test('URL checks accept only absolute http(s) URLs', () => {
  assert.equal(isHttpUrl('https://acme.example/logo.png'), true);
  assert.equal(isHttpUrl('http://localhost:3000/banner.jpg'), true);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('logo.png'), false);
  assert.equal(isHttpUrl(''), false);
});

test('form validation allows empty optional fields and flags bad ones', () => {
  assert.deepEqual(validateBrandProfile(DEFAULT_BRAND_PROFILE), {});
  const errors = validateBrandProfile({
    ...DEFAULT_BRAND_PROFILE,
    supportEmail: 'nope',
    logoUrl: 'not-a-url',
    accentColor: 'indigo',
    tagline: 'x'.repeat(161),
  });
  assert.deepEqual(Object.keys(errors).sort(), ['accentColor', 'logoUrl', 'supportEmail', 'tagline']);
});

test('API mapping round-trips between the merchant record and the form model', () => {
  const profile = brandProfileFromMerchant({
    name: 'Acme',
    tagline: 'Pay monthly',
    support_email: 'help@acme.example',
    website_url: 'https://acme.example',
    logo_url: null,
    banner_url: null,
    accent_color: '#123456',
  });
  assert.equal(profile.displayName, 'Acme');
  assert.equal(profile.logoUrl, '');
  assert.equal(profile.accentColor, '#123456');

  const patch = brandProfileToPatch(profile);
  assert.equal(patch.name, 'Acme');
  assert.equal(patch.support_email, 'help@acme.example');
  assert.equal(patch.banner_url, '');
});

test('a merchant with no accent color gets the Orbit default', () => {
  assert.equal(brandProfileFromMerchant({ name: 'X' }).accentColor, DEFAULT_BRAND_PROFILE.accentColor);
});
