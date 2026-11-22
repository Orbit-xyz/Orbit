"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Save } from "lucide-react";
import {
  DEFAULT_BRAND_PROFILE,
  brandProfileFromMerchant,
  brandProfileToPatch,
  evaluateAccentContrast,
  isHexColor,
  isHttpUrl,
  validateBrandProfile,
  type BrandProfile,
} from "@/lib/brand-profile";
import { fetchMerchantProfile, updateMerchantBrandProfile } from "@/lib/api";

type ImageStatus = "idle" | "checking" | "valid" | "invalid";

const IMAGE_CHECK_TIMEOUT_MS = 8000;

/**
 * Loads an image in the background to confirm the URL resolves to a real image.
 * Reports "invalid" for malformed URLs, load errors and timeouts.
 */
export function useImageStatus(url: string): ImageStatus {
  const [status, setStatus] = useState<ImageStatus>("idle");

  useEffect(() => {
    if (!url.trim()) {
      setStatus("idle");
      return undefined;
    }
    if (!isHttpUrl(url.trim())) {
      setStatus("invalid");
      return undefined;
    }
    let cancelled = false;
    setStatus("checking");
    const image = new Image();
    const timer = window.setTimeout(() => {
      if (!cancelled) setStatus("invalid");
    }, IMAGE_CHECK_TIMEOUT_MS);
    image.onload = () => {
      if (cancelled) return;
      window.clearTimeout(timer);
      setStatus("valid");
    };
    image.onerror = () => {
      if (cancelled) return;
      window.clearTimeout(timer);
      setStatus("invalid");
    };
    image.src = url.trim();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [url]);

  return status;
}

const fieldClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500";

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-neutral-800">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="block text-xs text-red-600">
          {error}
        </span>
      ) : hint ? (
        <span className="block text-xs text-neutral-500">{hint}</span>
      ) : null}
    </label>
  );
}

function ImageStatusBadge({ status }: { status: ImageStatus }) {
  if (status === "idle") return null;
  if (status === "checking") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Checking image…
      </span>
    );
  }
  if (status === "valid") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
        <CheckCircle2 className="h-3 w-3" aria-hidden /> Image loads
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-red-600">
      <AlertTriangle className="h-3 w-3" aria-hidden /> Image could not be loaded
    </span>
  );
}

/**
 * Split-screen preview of the hosted payment page and the checkout widget.
 * It renders straight from the form state, so every edit shows up immediately.
 */
export function BrandPreview({
  profile,
  logoStatus,
  bannerStatus,
}: {
  profile: BrandProfile;
  logoStatus: ImageStatus;
  bannerStatus: ImageStatus;
}) {
  const accent = isHexColor(profile.accentColor) ? profile.accentColor : DEFAULT_BRAND_PROFILE.accentColor;
  const name = profile.displayName || "Your business";
  const initials = name
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const showBanner = bannerStatus === "valid" && isHttpUrl(profile.bannerUrl);
  const showLogo = logoStatus === "valid" && isHttpUrl(profile.logoUrl);

  const card = (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div
        className="h-24 w-full bg-cover bg-center"
        style={{
          backgroundColor: accent,
          backgroundImage: showBanner ? `url("${profile.bannerUrl}")` : undefined,
        }}
        data-testid="preview-banner"
      />
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          {showLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.logoUrl} alt="" className="h-10 w-10 rounded object-contain" />
          ) : (
            <div
              className="flex h-10 w-10 items-center justify-center rounded text-sm font-semibold text-white"
              style={{ backgroundColor: accent }}
            >
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900">{name}</p>
            {profile.tagline && <p className="truncate text-xs text-neutral-600">{profile.tagline}</p>}
          </div>
        </div>
        <div className="flex items-center justify-between text-sm text-neutral-800">
          <span>Pro plan</span>
          <span className="font-semibold">29 USDC / month</span>
        </div>
        <button
          type="button"
          className="w-full rounded-lg px-4 py-2 text-sm font-semibold"
          style={{ backgroundColor: accent, color: "#ffffff" }}
          tabIndex={-1}
        >
          Subscribe
        </button>
        {profile.supportEmail && (
          <p className="text-center text-xs text-neutral-500">Questions? {profile.supportEmail}</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="brand-preview">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">Payment page · /pay/:id</p>
        {card}
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">Embedded &lt;OrbitCheckout /&gt;</p>
        <div className="rounded-xl bg-neutral-100 p-3">{card}</div>
      </div>
    </div>
  );
}

export function BrandSettingsView() {
  const [profile, setProfile] = useState<BrandProfile>(DEFAULT_BRAND_PROFILE);
  const [saved, setSaved] = useState<BrandProfile>(DEFAULT_BRAND_PROFILE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetchMerchantProfile()
      .then(({ merchant }) => {
        if (cancelled) return;
        const loaded = brandProfileFromMerchant(merchant);
        setProfile(loaded);
        setSaved(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Could not load brand profile.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const logoStatus = useImageStatus(profile.logoUrl);
  const bannerStatus = useImageStatus(profile.bannerUrl);
  const fieldErrors = useMemo(() => validateBrandProfile(profile), [profile]);
  const contrast = useMemo(() => evaluateAccentContrast(profile.accentColor), [profile.accentColor]);
  const isDirty = JSON.stringify(profile) !== JSON.stringify(saved);
  const hasErrors = Object.keys(fieldErrors).length > 0;

  const update = <K extends keyof BrandProfile>(key: K, value: BrandProfile[K]) => {
    setProfile((current) => ({ ...current, [key]: value }));
    setSaveMessage(null);
    setServerErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const handleSave = async () => {
    if (hasErrors || saving) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      await updateMerchantBrandProfile(brandProfileToPatch(profile));
      setSaved(profile);
      setSaveMessage({ kind: "ok", text: "Brand profile saved. Hosted pages and the widget will use it on next load." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save brand profile.";
      setSaveMessage({ kind: "error", text: message });
    } finally {
      setSaving(false);
    }
  };

  const errorFor = (key: keyof BrandProfile) => fieldErrors[key] || serverErrors[key];

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold text-neutral-900">Brand &amp; checkout</h2>
        <p className="text-sm text-neutral-600">
          Customize how your payment links and the checkout widget look to subscribers.
        </p>
      </header>

      {loadError && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Could not load your saved profile ({loadError}). You can still edit and save below.
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-8">
          <section className="space-y-4" aria-labelledby="brand-identity">
            <h3 id="brand-identity" className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Identity
            </h3>
            <Field label="Merchant display name" error={errorFor("displayName")}>
              <input className={fieldClass} value={profile.displayName} maxLength={120}
                onChange={(e) => update("displayName", e.target.value)} />
            </Field>
            <Field label="Tagline" hint={`${profile.tagline.length}/160`} error={errorFor("tagline")}>
              <input className={fieldClass} value={profile.tagline}
                onChange={(e) => update("tagline", e.target.value)} />
            </Field>
            <Field label="Support email" error={errorFor("supportEmail")}>
              <input className={fieldClass} type="email" value={profile.supportEmail}
                onChange={(e) => update("supportEmail", e.target.value)} />
            </Field>
            <Field label="Website URL" error={errorFor("websiteUrl")}>
              <input className={fieldClass} type="url" placeholder="https://" value={profile.websiteUrl}
                onChange={(e) => update("websiteUrl", e.target.value)} />
            </Field>
          </section>

          <section className="space-y-4" aria-labelledby="brand-assets">
            <h3 id="brand-assets" className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Assets
            </h3>
            <Field label="Logo image URL" error={errorFor("logoUrl") || (logoStatus === "invalid" ? "This image could not be loaded." : undefined)}>
              <input className={fieldClass} type="url" placeholder="https://…/logo.png" value={profile.logoUrl}
                onChange={(e) => update("logoUrl", e.target.value)} />
              <ImageStatusBadge status={logoStatus} />
            </Field>
            <Field label="Header banner image URL" error={errorFor("bannerUrl") || (bannerStatus === "invalid" ? "This image could not be loaded." : undefined)}>
              <input className={fieldClass} type="url" placeholder="https://…/banner.jpg" value={profile.bannerUrl}
                onChange={(e) => update("bannerUrl", e.target.value)} />
              <ImageStatusBadge status={bannerStatus} />
            </Field>
          </section>

          <section className="space-y-4" aria-labelledby="brand-color">
            <h3 id="brand-color" className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Accent color
            </h3>
            <div className="flex items-center gap-3">
              <input
                type="color"
                aria-label="Accent color picker"
                className="h-10 w-14 cursor-pointer rounded border border-neutral-300"
                value={isHexColor(profile.accentColor) ? profile.accentColor : DEFAULT_BRAND_PROFILE.accentColor}
                onChange={(e) => update("accentColor", e.target.value)}
              />
              <input
                className={`${fieldClass} font-mono`}
                aria-label="Accent color hex value"
                value={profile.accentColor}
                onChange={(e) => update("accentColor", e.target.value)}
              />
            </div>
            {errorFor("accentColor") && (
              <p role="alert" className="text-xs text-red-600">{errorFor("accentColor")}</p>
            )}
            {isHexColor(profile.accentColor) ? (
              contrast.warnings.length > 0 ? (
                <div role="alert" className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">Low contrast for readability</p>
                  {contrast.warnings.map((warning) => (
                    <p key={warning} className="text-xs">{warning}</p>
                  ))}
                </div>
              ) : (
                <p className="flex items-center gap-1 text-xs text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" aria-hidden /> Passes WCAG AA contrast
                  ({contrast.whiteOnAccent}:1 on white button text)
                </p>
              )
            ) : null}
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || hasErrors || saving || loading}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
              Save brand profile
            </button>
            {saveMessage && (
              <p role="status" className={`text-sm ${saveMessage.kind === "ok" ? "text-emerald-700" : "text-red-600"}`}>
                {saveMessage.text}
              </p>
            )}
          </div>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <BrandPreview profile={profile} logoStatus={logoStatus} bannerStatus={bannerStatus} />
        </div>
      </div>
    </div>
  );
}
