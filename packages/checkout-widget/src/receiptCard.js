// Helpers for the post-checkout receipt card: explorer links, share intents,
// cadence labels and a dependency-free PNG snapshot.

export function explorerTxUrl(hash, isMainnet = false) {
  return `https://stellar.expert/explorer/${isMainnet ? "public" : "testnet"}/tx/${encodeURIComponent(hash)}`;
}

export function cadenceLabel(intervalSeconds) {
  const secs = Number(intervalSeconds);
  if (!Number.isFinite(secs) || secs <= 0) return "Recurring";
  const days = Math.max(1, Math.round(secs / 86400));
  if (days === 1) return "Daily";
  if (days === 7) return "Weekly";
  if (days >= 28 && days <= 31) return "Monthly";
  if (days >= 365 && days <= 366) return "Yearly";
  return `Every ${days} days`;
}

export function buildShareText(planName) {
  return `Just subscribed to ${planName || "a plan"} on @OrbitNetwork rails!`;
}

export function xShareUrl(text, url) {
  const params = new URLSearchParams({ text });
  if (url) params.set("url", url);
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

export function farcasterShareUrl(text, url) {
  const params = new URLSearchParams({ text });
  if (url) params.append("embeds[]", url);
  return `https://warpcast.com/~/compose?${params.toString()}`;
}

export function shortHash(hash) {
  const h = String(hash || "");
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-8)}` : h;
}

/** Render the receipt to a PNG Blob using a detached canvas (nothing is attached to the DOM). */
export function renderReceiptPng({ merchant, plan, amount, cadence, hash }) {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, 800, 480);
  ctx.fillStyle = "#22c55e";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText("✓ Subscription confirmed", 40, 70);
  const rows = [
    ["Merchant", merchant],
    ["Plan", plan],
    ["Amount", amount],
    ["Cadence", cadence],
    ["Transaction", shortHash(hash)],
  ];
  rows.forEach(([label, value], i) => {
    const y = 140 + i * 56;
    ctx.fillStyle = "#94a3b8";
    ctx.font = "18px sans-serif";
    ctx.fillText(label, 40, y);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(String(value || "-"), 240, y);
  });
  ctx.fillStyle = "#64748b";
  ctx.font = "14px sans-serif";
  ctx.fillText("Powered by Orbit on Stellar", 40, 450);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"),
  );
}

export async function downloadReceiptPng(details) {
  const blob = await renderReceiptPng(details);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orbit-receipt-${String(details.hash || "").slice(0, 8)}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
