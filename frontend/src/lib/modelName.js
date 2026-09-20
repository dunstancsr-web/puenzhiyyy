// A model's id as the gateway reports it ("global.anthropic.claude-sonnet-4-5-20250929-v1:0") is for machines.
// Anything a person reads shows "Claude Sonnet 4.5" instead. Local model names ("llama3") pass through as they
// are. The audit trail keeps the raw id, because spend.js prices calls by it.
// (backend/src/llm/provider.js has the same three lines for the Settings text: keep them alike.)
export function modelLabel(id) {
  const m = String(id || "").match(/claude-(sonnet|haiku|opus)-(\d+)(?:-(\d{1,2}))?(?!\d)/i);
  if (!m) return id || "";
  const family = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return `Claude ${family} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}
