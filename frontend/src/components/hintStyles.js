// Frosted hover-panel style shared by ColHint + HoverHint — the same light
// frosted card in every app theme.
//
// Tuned sheer: you can read the panel while still seeing what's underneath.
// Safe self-tune range (keeps the dark body text legible over any backdrop,
// including the busy glass theme):
//   background alpha : 0.30 – 0.75     (lower = sheerer; heavy blur carries it)
//   backdrop blur     : 18px – 40px    (raise blur whenever you lower alpha)
//   saturate          : 150% – 190%
// Below alpha 0.30 / blur 18px the text starts to lose contrast on busy
// backgrounds; above ~0.75 it stops reading as glass.

export const HINT_PANEL_STYLE = {
  padding: "13px 15px",
  borderRadius: 12,
  zIndex: 9999,
  background: "rgba(250,250,252,0.38)",
  backdropFilter: "blur(34px) saturate(180%)",
  WebkitBackdropFilter: "blur(34px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.55)",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.55), 0 18px 48px rgba(15,23,42,0.28), 0 0 0 1px rgba(15,23,42,0.05)",
  color: "#0f172a",
};

export const HINT_HDR_STYLE = {
  fontSize: 12,
  fontWeight: 700,
  color: "#475569",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 6,
};

export const HINT_BODY_STYLE = { fontSize: 14, lineHeight: 1.65, color: "#1e293b" };
