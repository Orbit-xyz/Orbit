import {
  SANDBOX_DELAY_OPTIONS_MS,
  SANDBOX_OUTCOMES,
} from "./sandbox.js";

const OUTCOME_LABELS = {
  [SANDBOX_OUTCOMES.SUCCESS]: "Instant success",
  [SANDBOX_OUTCOMES.INSUFFICIENT_BALANCE]: "Insufficient balance",
  [SANDBOX_OUTCOMES.USER_REJECTED]: "User rejected",
  [SANDBOX_OUTCOMES.NETWORK_TIMEOUT]: "Network timeout",
};

const barStyle = {
  position: "fixed",
  bottom: 8,
  left: 8,
  zIndex: 2147483647,
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 8,
  background: "rgba(15, 23, 42, 0.88)",
  color: "#e2e8f0",
  font: "12px/1.4 system-ui, sans-serif",
  boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
};

const selectStyle = {
  font: "inherit",
  background: "#1e293b",
  color: "inherit",
  border: "1px solid #334155",
  borderRadius: 4,
  padding: "2px 4px",
};

/**
 * Developer-only controls rendered when `<OrbitCheckout sandbox />` is set.
 * Changes apply to the next simulated subscription. Nothing here is shown in
 * production because the widget only mounts it in sandbox mode.
 */
export function SandboxToolbar({ settings, onChange, status }) {
  return (
    <div role="region" aria-label="Orbit sandbox controls" data-orbit-sandbox="true" style={barStyle}>
      <strong>SANDBOX</strong>
      <label>
        Outcome{" "}
        <select
          aria-label="Simulation outcome"
          style={selectStyle}
          value={settings.outcome}
          onChange={(event) => onChange({ ...settings, outcome: event.target.value })}
        >
          {Object.entries(OUTCOME_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Delay{" "}
        <select
          aria-label="Confirmation delay"
          style={selectStyle}
          value={settings.delayMs}
          onChange={(event) => onChange({ ...settings, delayMs: Number(event.target.value) })}
        >
          {SANDBOX_DELAY_OPTIONS_MS.map((ms) => (
            <option key={ms} value={ms}>
              {ms === 0 ? "none" : `${ms / 1000}s`}
            </option>
          ))}
        </select>
      </label>
      {status && <span data-testid="sandbox-status">state: {status}</span>}
    </div>
  );
}
