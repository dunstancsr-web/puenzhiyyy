// Frosted hover-panel style shared by ColHint + HoverHint — the same light
// frosted card in every app theme. Safe self-tune range (keeps body text
// legible over any backdrop, including the glass theme):
//   background alpha : 0.50 – 0.85     (lower = sheerer)
//   backdrop blur     : 12px – 24px    (raise blur when you lower alpha)
//   saturate          : 150% – 200%
// Going below alpha 0.50 / blur 12px loses contrast on busy backgrounds;
// above these it stops reading as glass.

export const HINT_PANEL_STYLE = {
  padding: "14px 16px",
  borderRadius: 12,
  zIndex: 9999,
  background: "rgba(252,252,254,0.50)",
  backdropFilter: "blur(22px) saturate(185%)",
  WebkitBackdropFilter: "blur(22px) saturate(185%)",
  border: "1px solid rgba(255,255,255,0.65)",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.6), 0 16px 40px rgba(15,23,42,0.22), 0 0 0 1px rgba(15,23,42,0.06)",
  color: "#1e293b",
};

export const HINT_HDR_STYLE = {
  fontSize: 11,
  fontWeight: 700,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 6,
};

export const HINT_BODY_STYLE = { fontSize: 12, lineHeight: 1.7, color: "#334155" };
