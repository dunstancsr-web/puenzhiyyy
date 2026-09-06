import React from "react";
import { useTheme } from "../context/ThemeContext";
import HoverHint from "./HoverHint";

// ─────────────────────────────────────────────────────────────────────────────
// Bullet-graph style stock gauge (after Stephen Few):
//   • one coloured measure bar  = available stock, coloured by health status
//   • greyscale "avoid" ranges  = below the reorder point / above maximum
//   • tick marks + labels beneath = reorder point and maximum
// Each part explains itself on hover (HoverHint).
// ─────────────────────────────────────────────────────────────────────────────

const FILL = { red: "var(--red)", amber: "var(--yellow)", green: "var(--green)", purple: "var(--purple)" };

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const fmt = (n) => Math.round(n).toLocaleString("en-SG");

// ── Explanatory copy ───────────────────────────────────────────────────────
const AVAIL_COPY =
  "Available stock — physical stock minus what's reserved for confirmed orders and held for quality checks. This is what you can actually sell or ship today. Its colour is the health status.";
const TRACK_COPY =
  "The coloured bar is available stock. The tick marks are your reorder point and your maximum. Grey shading marks the ranges to avoid — below the reorder point (order now) or above the maximum (overstock). Aim to keep the bar between the two ticks.";
const MAX_LABEL_COPY =
  "Maximum stock level. Holding more than this ties up cash and warehouse space — it shows as a purple bar running into the grey zone on the right.";
const RESERVED_COPY =
  "Stock already committed to confirmed customer orders. Still in the warehouse, but can't be promised to anyone else.";
const reorderCopy = (showReorder) =>
  showReorder
    ? "Reorder point — when available stock drops to this tick, place a replenishment order. It's set to cover demand over the supplier's lead time plus a safety buffer."
    : "No reorder point yet — it needs a lead time and some sales history before one can be calculated.";
const gapCopy = (idle) =>
  idle
    ? "This SKU has had no recent demand, so there's no meaningful gap to the reorder point."
    : "How far available stock is from the reorder point. Below it (red) means order now; above it (green) is the buffer you have left.";

// Absolute label positioned under a tick, edge-aware so it never clips.
function tickLabelStyle(pct, strong) {
  const base = {
    position: "absolute", whiteSpace: "nowrap",
    fontWeight: strong ? 700 : 400,
    color: strong ? "var(--text-secondary)" : "var(--text-muted)",
  };
  if (pct < 12) return { ...base, left: `${pct}%` };
  if (pct > 88) return { ...base, right: `${100 - pct}%` };
  return { ...base, left: `${pct}%`, transform: "translateX(-50%)" };
}

export default function StockPositionBar({
  available, minStock, reorder, maxStock, reservedQty, idle,
  target, axisMax, animateFill = true,
}) {
  const { theme } = useTheme();
  const rangeShade = theme === "light" ? "rgba(15,23,42,0.13)" : "rgba(255,255,255,0.15)";

  const avail = Number(available) || 0;
  const rop = Number(reorder) || 0;
  const max = Number(maxStock) || 0;
  const tgt = Number(target) || 0;
  const showReorder = rop > 0;
  const showMax = max > 0;

  const finalAxisMax = Number(axisMax) > 0
    ? Number(axisMax)
    : Math.max(max, avail, rop, tgt) * 1.05;

  if (!finalAxisMax || finalAxisMax <= 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 220 }}>
        No stock policy set
      </div>
    );
  }

  const pct = (v) => clamp((v / finalAxisMax) * 100, 0, 100);
  const fillPct = pct(avail);
  const reorderPct = pct(rop);
  const maxPct = pct(max);
  const targetPct = tgt > 0 ? pct(tgt) : null;
  const belowEnd = showReorder ? Math.min(reorderPct, showMax ? maxPct : 100) : 0;

  // Health status of the measure bar — kept consistent with the gap wording.
  const zoneKey = idle
    ? "idle"
    : showMax && avail >= max ? "purple"
    : !showReorder ? "green"
    : avail < rop ? "red"
    : avail < rop * 1.15 ? "amber"
    : "green";
  const fillColor = zoneKey === "idle" ? "var(--text-muted)" : FILL[zoneKey];
  const valueColor = zoneKey === "idle" ? "var(--text-secondary)" : FILL[zoneKey];

  // Status line under the bar
  let gapText, gapColor, gapWeight = 600;
  if (idle) {
    gapText = "Idle — no recent demand";
    gapColor = "var(--text-secondary)";
  } else if (showMax && avail > max) {
    gapText = `${fmt(avail - max)} MT over maximum`;
    gapColor = "var(--purple)";
    gapWeight = 700;
  } else if (!showReorder) {
    gapText = "";
    gapColor = "var(--text-muted)";
  } else {
    const gap = avail - rop;
    if (gap < 0) {
      gapText = `${fmt(-gap)} MT below reorder point`;
      gapColor = "var(--red)";
      gapWeight = 700;
    } else if (gap < rop * 0.15) {
      gapText = `+${fmt(gap)} MT — near reorder point`;
      gapColor = "var(--yellow)";
    } else {
      gapText = `+${fmt(gap)} MT above reorder point`;
      gapColor = "var(--green)";
    }
  }

  const shade = (left, right) =>
    right > left && (
      <div style={{
        position: "absolute", top: 0, height: "100%",
        left: `${left}%`, width: `${right - left}%`, background: rangeShade,
      }} />
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 240 }}>
      {/* value */}
      <HoverHint panelWidth={260} content={AVAIL_COPY}>
        <span style={{ fontSize: 14 }}>
          <span style={{ fontWeight: 800, color: valueColor }}>{fmt(avail)} MT</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}> available</span>
        </span>
      </HoverHint>

      {/* track */}
      <HoverHint panelWidth={260} content={TRACK_COPY}>
        <div
          className="hint-trigger--box"
          style={{
            position: "relative", height: 10, borderRadius: 99,
            background: "var(--border)", overflow: "visible",
            opacity: idle ? 0.6 : 1,
          }}
        >
          {/* greyscale "avoid" ranges */}
          {shade(0, belowEnd)}
          {showMax && shade(maxPct, 100)}

          {/* measure bar */}
          <div style={{
            position: "absolute", left: 0, top: 0, height: "100%",
            width: `${fillPct}%`, borderRadius: 99,
            background: fillColor, opacity: idle ? 0.65 : 1,
            transition: animateFill ? "width 0.4s ease" : "none",
          }} />

          {/* target tick (hollow — preview only) */}
          {targetPct != null && (
            <div style={{
              position: "absolute", top: -1, left: `calc(${targetPct}% - 1px)`,
              width: 2, height: 12, borderRadius: 1,
              border: "1px solid var(--text-muted)", background: "transparent",
            }} />
          )}

          {/* max tick */}
          {showMax && (
            <div style={{
              position: "absolute", top: -3, left: `calc(${maxPct}% - 1px)`,
              width: 2, height: 16, borderRadius: 1, background: "var(--text-muted)",
            }} />
          )}

          {/* reorder tick */}
          {showReorder && (
            <div style={{
              position: "absolute", top: -3, left: `calc(${reorderPct}% - 1.5px)`,
              width: 3, height: 19, borderRadius: 2, background: "var(--text-primary)",
            }} />
          )}
        </div>
      </HoverHint>

      {/* axis labels — sit under their ticks */}
      <div style={{ position: "relative", height: 13, fontSize: 10, marginTop: 1 }}>
        <span style={{ position: "absolute", left: 0, color: "var(--text-muted)" }}>0</span>
        {showReorder && (
          <HoverHint panelWidth={260} content={reorderCopy(true)}>
            <span style={tickLabelStyle(reorderPct, true)}>Reorder {fmt(rop)} MT</span>
          </HoverHint>
        )}
        {!showReorder && (
          <HoverHint panelWidth={260} content={reorderCopy(false)}>
            <span style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", color: "var(--text-muted)" }}>
              no reorder point
            </span>
          </HoverHint>
        )}
        {showMax && (
          <HoverHint panelWidth={260} content={MAX_LABEL_COPY}>
            <span style={tickLabelStyle(maxPct, false)}>Max {fmt(max)} MT</span>
          </HoverHint>
        )}
      </div>

      {/* status line */}
      {gapText && (
        <HoverHint panelWidth={260} content={gapCopy(idle)}>
          <div style={{ fontSize: 12, fontWeight: gapWeight, color: gapColor }}>{gapText}</div>
        </HoverHint>
      )}

      {reservedQty > 0 && (
        <HoverHint panelWidth={260} content={RESERVED_COPY}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmt(reservedQty)} MT reserved</div>
        </HoverHint>
      )}
    </div>
  );
}
