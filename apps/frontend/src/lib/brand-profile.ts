/**
 * Brand profile helpers for the merchant dashboard and checkout preview (#350).
 * Pure functions only, so the contrast rules and API mapping are unit-tested
 * without rendering the dashboard.
 */

export interface BrandProfile {
  displayName: string;
  tagline: string;
  supportEmail: string;
  websiteUrl: string;
  logoUrl: string;
  bannerUrl: string;
  accentColor: string;
}

export const DEFAULT_BRAND_PROFILE: BrandProfile = {
  displayName: "",
  tagline: "",
  supportEmail: "",
  websiteUrl: "",
  logoUrl: "",
  bannerUrl: "",
  accentColor: "#4f46e5",
};

/** WCAG 2.x contrast thresholds. */
export const WCAG_AA_NORMAL_TEXT = 4.5;
export const WCAG_AA_LARGE_TEXT = 3;
export const WCAG_AAA_NORMAL_TEXT = 7;

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isHexColor(value: string): boolean {
  return HEX_PATTERN.test(value);
}

function channelToLinear(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

/** Relative luminance per WCAG 2.x, or null for an invalid color. */
export function relativeLuminance(hex: string): number | null {
  if (!isHexColor(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

/** Contrast ratio between two colors (1 to 21), or null if either is invalid. */
export function contrastRatio(foreground: string, background: string): number | null {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  if (a === null || b === null) return null;
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

export interface AccentContrastReport {
  /** Accent used as text on a white page background. */
  accentOnWhite: number | null;
  /** White button label on the accent background. */
  whiteOnAccent: number | null;
  /** True when both pairings meet WCAG AA for normal-size text. */
  readable: boolean;
  /** Human-readable warnings for the settings form. Empty when readable. */
  warnings: string[];
}

export function evaluateAccentContrast(accent: string): AccentContrastReport {
  const accentOnWhite = contrastRatio(accent, "#ffffff");
  const whiteOnAccent = contrastRatio("#ffffff", accent);
  const warnings: string[] = [];

  if (accentOnWhite === null || whiteOnAccent === null) {
    warnings.push("Enter a 6-digit hex color such as #4f46e5.");
    return { accentOnWhite, whiteOnAccent, readable: false, warnings };
  }
  if (accentOnWhite < WCAG_AA_NORMAL_TEXT) {
    warnings.push(
      `Accent text on white is ${accentOnWhite}:1. WCAG AA needs ${WCAG_AA_NORMAL_TEXT}:1 for normal text, so links and labels may be hard to read.`,
    );
  }
  if (whiteOnAccent < WCAG_AA_NORMAL_TEXT) {
    warnings.push(
      `White button text on this accent is ${whiteOnAccent}:1. WCAG AA needs ${WCAG_AA_NORMAL_TEXT}:1, so the pay button label may be hard to read.`,
    );
  }
  return {
    accentOnWhite,
    whiteOnAccent,
    readable: warnings.length === 0,
    warnings,
  };
}

/** Accepts only absolute http(s) URLs, which is what the backend also allows. */
export function isHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

/** Field-level validation for the form. Empty optional fields are valid. */
export function validateBrandProfile(profile: BrandProfile): Partial<Record<keyof BrandProfile, string>> {
  const errors: Partial<Record<keyof BrandProfile, string>> = {};
  if (profile.tagline.length > 160) errors.tagline = "Keep the tagline to 160 characters.";
  if (profile.supportEmail && !isEmail(profile.supportEmail)) errors.supportEmail = "Enter a valid email address.";
  if (profile.websiteUrl && !isHttpUrl(profile.websiteUrl)) errors.websiteUrl = "Use a full URL starting with https://.";
  if (profile.logoUrl && !isHttpUrl(profile.logoUrl)) errors.logoUrl = "Use a full image URL starting with https://.";
  if (profile.bannerUrl && !isHttpUrl(profile.bannerUrl)) errors.bannerUrl = "Use a full image URL starting with https://.";
  if (!isHexColor(profile.accentColor)) errors.accentColor = "Use a 6-digit hex color such as #4f46e5.";
  return errors;
}

/** Maps the API's merchant record to the form model. */
export function brandProfileFromMerchant(merchant: {
  name?: string;
  tagline?: string | null;
  support_email?: string | null;
  website_url?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
  accent_color?: string | null;
}): BrandProfile {
  return {
    displayName: merchant.name ?? "",
    tagline: merchant.tagline ?? "",
    supportEmail: merchant.support_email ?? "",
    websiteUrl: merchant.website_url ?? "",
    logoUrl: merchant.logo_url ?? "",
    bannerUrl: merchant.banner_url ?? "",
    accentColor: merchant.accent_color ?? DEFAULT_BRAND_PROFILE.accentColor,
  };
}

/** Builds the PATCH /merchant/profile body. Empty strings clear a field on the server. */
export function brandProfileToPatch(profile: BrandProfile) {
  return {
    name: profile.displayName.trim() || undefined,
    tagline: profile.tagline.trim(),
    support_email: profile.supportEmail.trim(),
    website_url: profile.websiteUrl.trim(),
    logo_url: profile.logoUrl.trim(),
    banner_url: profile.bannerUrl.trim(),
    accent_color: profile.accentColor.trim(),
  };
}
