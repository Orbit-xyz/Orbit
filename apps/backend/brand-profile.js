/**
 * Brand profile validation for the merchant dashboard (#350).
 *
 * `validateBrandPatch` takes the body of `PATCH /merchant/profile`, keeps only
 * the brand fields, and returns either a normalized patch or a list of
 * field-level errors. Empty strings clear a field to null. Fields that are not
 * present are left alone so partial updates work.
 */

const BRAND_FIELDS = Object.freeze([
  'tagline',
  'support_email',
  'website_url',
  'logo_url',
  'banner_url',
  'accent_color',
]);

const MAX_TAGLINE = 160;
const MAX_URL = 2048;
const MAX_EMAIL = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function checkHttpUrl(value) {
  if (value.length > MAX_URL) return 'must be at most 2048 characters';
  let url;
  try {
    url = new URL(value);
  } catch {
    return 'must be a valid absolute URL';
  }
  return ['https:', 'http:'].includes(url.protocol) ? null : 'must start with http:// or https://';
}

const FIELD_RULES = {
  tagline(value) {
    if (value.length > MAX_TAGLINE) return `must be at most ${MAX_TAGLINE} characters`;
    return null;
  },
  support_email(value) {
    if (value.length > MAX_EMAIL || !EMAIL_PATTERN.test(value)) return 'must be a valid email address';
    return null;
  },
  website_url(value) {
    return checkHttpUrl(value);
  },
  logo_url(value) {
    return checkHttpUrl(value);
  },
  banner_url(value) {
    return checkHttpUrl(value);
  },
  accent_color(value) {
    if (!HEX_COLOR_PATTERN.test(value)) return 'must be a 6-digit hex color such as #4f46e5';
    return null;
  },
};

/**
 * @param {object} body  Request body from PATCH /merchant/profile.
 * @returns {{ ok: true, patch: object } | { ok: false, errors: Record<string, string> }}
 */
function validateBrandPatch(body) {
  const patch = {};
  const errors = {};
  if (!body || typeof body !== 'object') return { ok: true, patch };

  for (const field of BRAND_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const raw = body[field];

    if (raw === null || raw === undefined) {
      patch[field] = null;
      continue;
    }
    if (typeof raw !== 'string') {
      errors[field] = 'must be a string';
      continue;
    }

    const value = raw.trim();
    if (value === '') {
      patch[field] = null;
      continue;
    }
    const problem = FIELD_RULES[field](value);
    if (problem) {
      errors[field] = problem;
    } else {
      patch[field] = field === 'accent_color' ? value.toLowerCase() : value;
    }
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, patch };
}

module.exports = { BRAND_FIELDS, validateBrandPatch };
