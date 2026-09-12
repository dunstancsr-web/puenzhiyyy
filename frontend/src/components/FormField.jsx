import React from "react";

// Module-scope so the input identity is stable across parent re-renders
// (an inline component definition remounts every keystroke → focus loss).

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Round a positive number UP to the next 1 / 2 / 5 × 10ⁿ boundary — used to
// keep a slider's max from drifting as the user drags.
export function niceCeil(n) {
  if (!Number.isFinite(n) || n <= 0) return 10;
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  const f = n / mag;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * mag;
}

const wrapStyle = (half) => ({ gridColumn: half ? "span 1" : "span 2", minWidth: 0 });

const labelStyle = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 4,
  color: "var(--text-secondary)",
};

const inputStyle = (error) => ({
  width: "100%",
  padding: "8px 11px",
  border: `1px solid ${error ? "var(--red)" : "var(--border)"}`,
  borderRadius: "var(--radius)",
  fontSize: 14,
  background: "var(--surface)",
  color: "var(--text-primary)",
});

const errorStyle = { fontSize: 12, color: "var(--red)", marginTop: 3 };

export function TextField({ label, value, onChange, placeholder, required, half, error }) {
  return (
    <div style={wrapStyle(half)}>
      <label style={labelStyle}>
        {label}
        {required && <span style={{ color: "var(--red)" }}> *</span>}
      </label>
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle(error)}
      />
      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
}

export function NumberField({
  label, value, onChange, placeholder, step = "any", min, max, suffix, half, error,
}) {
  return (
    <div style={wrapStyle(half)}>
      <label style={labelStyle}>{label}</label>
      <div style={{ position: "relative" }}>
        <input
          type="number"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          step={step}
          min={min}
          max={max}
          style={{ ...inputStyle(error), paddingRight: suffix ? 34 : 11 }}
        />
        {suffix && (
          <span
            style={{
              position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
              fontSize: 13, color: "var(--text-muted)", pointerEvents: "none",
            }}
          >
            {suffix}
          </span>
        )}
      </div>
      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
}

// Range slider + editable number. Keeps NumberField's onChange(rawString)
// contract, so form coercion/validation is unchanged. Only the thumb position
// clamps to [min,max] — the stored string keeps whatever the user last entered
// (so mid-edit "" / "1." / out-of-range values aren't clobbered).
// Keyboard (Arrow ±step, Home/End, PageUp/Down) and touch-drag come free from
// the native <input type="range">.
export function SliderField({
  label, value, onChange, min = 0, max = 100, step = 1, suffix, error, half, disabled,
}) {
  const num = Number(value);
  const rangeValue = Number.isFinite(num) ? clamp(num, min, max) : min;

  return (
    <div style={wrapStyle(half)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, gap: 8 }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>{label}</label>
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, flexShrink: 0 }}>
          <input
            type="number"
            inputMode="decimal"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            // step="any" deliberately, NOT the slider's `step`: this box must accept
            // whatever value the SKU already has (e.g. a seeded 302 against a step-5
            // slider). Sharing `step` here means the browser's native HTML5 constraint
            // validation silently blocks form submission for any pre-existing value
            // that isn't an exact multiple — no JS error, no network call, nothing
            // visible. Found via a real Save-button click producing zero effect.
            step="any"
            min={min}
            max={max}
            disabled={disabled}
            style={{ ...inputStyle(error), width: 64, padding: "4px 7px", fontSize: 13, textAlign: "right" }}
          />
          {suffix && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{suffix}</span>}
        </span>
      </div>
      <input
        type="range"
        className="sf-range"
        min={min}
        max={max}
        step={step}
        value={rangeValue}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
}
