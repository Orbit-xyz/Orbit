import { describe, it, expect } from 'vitest';
import brand from '../brand-profile.js';

const { validateBrandPatch, BRAND_FIELDS } = brand;

describe('validateBrandPatch (#350)', () => {
  it('ignores fields that are not brand fields and leaves absent fields alone', () => {
    const result = validateBrandPatch({ name: 'Acme', contract_id: 'C1', tagline: 'Fast pay' });
    expect(result).toEqual({ ok: true, patch: { tagline: 'Fast pay' } });
  });

  it('accepts a full, valid brand profile and normalizes the accent color', () => {
    const result = validateBrandPatch({
      tagline: 'Subscriptions made simple',
      support_email: 'help@acme.example',
      website_url: 'https://acme.example',
      logo_url: 'https://cdn.acme.example/logo.png',
      banner_url: 'http://acme.example/banner.jpg',
      accent_color: '#4F46E5',
    });
    expect(result.ok).toBe(true);
    expect(result.patch.accent_color).toBe('#4f46e5');
    expect(result.patch.website_url).toBe('https://acme.example');
  });

  it('treats empty strings and nulls as clearing a field', () => {
    const result = validateBrandPatch({ logo_url: '   ', tagline: '', accent_color: null });
    expect(result).toEqual({
      ok: true,
      patch: { logo_url: null, tagline: null, accent_color: null },
    });
  });

  it('rejects malformed emails, URLs and colors with field-level errors', () => {
    const result = validateBrandPatch({
      support_email: 'not-an-email',
      website_url: 'javascript:alert(1)',
      logo_url: 'not a url',
      accent_color: 'red',
    });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(
      ['accent_color', 'logo_url', 'support_email', 'website_url'],
    );
  });

  it('enforces length limits on the tagline and URLs', () => {
    const longTagline = 'x'.repeat(161);
    const longUrl = `https://example.com/${'a'.repeat(2100)}`;
    const result = validateBrandPatch({ tagline: longTagline, banner_url: longUrl });
    expect(result.ok).toBe(false);
    expect(result.errors.tagline).toMatch(/160/);
    expect(result.errors.banner_url).toMatch(/2048/);
  });

  it('rejects non-string values', () => {
    const result = validateBrandPatch({ tagline: 42, accent_color: ['#000000'] });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual({ tagline: 'must be a string', accent_color: 'must be a string' });
  });

  it('exposes exactly the brand columns the migration creates', () => {
    expect(BRAND_FIELDS).toEqual([
      'tagline',
      'support_email',
      'website_url',
      'logo_url',
      'banner_url',
      'accent_color',
    ]);
  });
});
