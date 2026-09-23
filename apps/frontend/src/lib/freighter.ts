import { isConnected, requestAccess, getAddress } from "@stellar/freighter-api";

/**
 * Freighter connection helper.
 *
 * Talks to the extension through the official @stellar/freighter-api package
 * rather than sniffing window globals. The extension communicates over a
 * content-script message bridge that is injected asynchronously, so a global
 * like `window.freighterApi` is not reliably present at click time. Freighter
 * v5 also renamed `getPublicKey()` to `getAddress()`, so the old global check
 * fails even when the wallet is installed and unlocked.
 */

export type FreighterResult =
  | { ok: true; address: string }
  | { ok: false; error: string };

const NOT_INSTALLED =
  "Freighter not detected. Install the extension, then reload this page.";

export async function connectFreighter(): Promise<FreighterResult> {
  try {
    const connection = await isConnected();
    if (connection.error || !connection.isConnected) {
      return { ok: false, error: NOT_INSTALLED };
    }

    // Prompts the user to share an address the first time; returns the
    // already-shared one on subsequent calls.
    const access = await requestAccess();
    if (access.address) {
      return { ok: true, address: access.address };
    }
    if (access.error) {
      return { ok: false, error: access.error.message || "Freighter rejected the request." };
    }

    // requestAccess can resolve empty when the wallet is locked but access was
    // granted earlier; getAddress then returns the shared address.
    const current = await getAddress();
    if (current.address) {
      return { ok: true, address: current.address };
    }

    return {
      ok: false,
      error: current.error?.message || "Freighter did not return an address.",
    };
  } catch (err) {
    console.warn("Freighter connection failed:", err);
    return { ok: false, error: "Could not reach Freighter. Is the extension unlocked?" };
  }
}
