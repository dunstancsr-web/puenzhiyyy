import React, { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { api } from "../api/inventory";
import { useLlmTier, setPass, setTierChoice } from "../lib/llmTier";

// ─────────────────────────────────────────────────────────────────────────────
// ASK FOR THE DEMO PIN WHERE THE AI IS WANTED
//
// The PIN used to live only in Settings, so a visitor who pressed Why? and got
// the rule-based answer had no way to know the AI existed, let alone where to
// unlock it. This asks in place: a banner on the page and a field inside the
// Why? box, both the same form. It uses the same server call and the same
// storage as Settings (lib/llmTier.js), so the two never disagree, and a wrong
// PIN is counted and locked out by the server exactly as before.
//
// It renders nothing unless the server can actually offer the paid tier and
// this visitor has not unlocked it: a local developer with no PIN gate, or a
// server with no gateway key, never sees a prompt that could not work.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The whole picture a feature needs to offer its own paid option (22 Sep,
 * first used by Market Signals' cloud-scan toggle): whether the server can
 * offer the cloud tier at all, whether THIS visitor still needs the PIN for
 * it, and the pass itself, ready to send. One fetch, shared by useAiLocked
 * below so nothing duplicates the server call.
 */
export function useAiAvailability() {
  const [server, setServer] = useState(null);
  const { pass } = useLlmTier();
  useEffect(() => { api.getLlmMode().then(setServer).catch(() => setServer(null)); }, []);
  const cloud = server?.modes?.find((m) => m.id === "cloud");
  const available = !!cloud?.available;
  const locked = available && !!cloud.requiresPin && !pass;
  return { available, locked, pass };
}

/** True when the paid tier exists on this server and this visitor still needs the PIN for it. */
export function useAiLocked() {
  return useAiAvailability().locked;
}

/**
 * @param {"banner"|"inline"} variant  banner sits at the top of a page; inline sits inside a Why? box
 * @param {() => void} [onUnlocked]    called after a right PIN, so an open Why? box can ask again at once
 */
export default function UnlockAI({ variant = "inline", onUnlocked }) {
  const locked = useAiLocked();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!locked) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!pin.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      setPass(await api.unlockLlm(pin.trim()));
      setTierChoice("cloud");
      onUnlocked?.();
    } catch (err) {
      // The server words this to be shown ("2 tries left", "try again in 15 min"), so it is not rephrased here.
      setError(err.message);
    } finally {
      // Cleared on failure too: a wrong PIN left in the box invites resubmitting it, and each try is counted.
      setPin("");
      setBusy(false);
    }
  };

  const banner = variant === "banner";
  return (
    <form
      onSubmit={submit}
      className={banner ? "card" : undefined}
      style={{
        padding: banner ? "14px 20px" : "12px 14px",
        marginBottom: banner ? 20 : 16,
        background: banner ? undefined : "var(--purple-light)",
        borderRadius: "var(--radius)",
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 16px",
      }}
    >
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", fontWeight: 700 }}>
          <KeyRound size={15} aria-hidden /> {banner ? "AI explanations are off" : "Want it in plainer words?"}
        </div>
        {/* The banner's explanation is dropped on a phone (index.css): the title and the field say enough, and the
            full sentence made the strip taller than the page's own heading. */}
        <div className={banner ? "unlock-ai__desc" : undefined} style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 3 }}>
          {banner
            ? "Enter the demo PIN to have Claude explain any alert or action in plain English. The figures always come from the engines."
            : "Enter the demo PIN to have Claude write this up. The figures stay the engines' own."}
        </div>
        {error && (
          <div role="alert" style={{ fontSize: "var(--text-xs)", color: "var(--red-text)", marginTop: 4 }}>{error}</div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="password" name="demo-pin" value={pin} onChange={(e) => setPin(e.target.value)}
          autoComplete="one-time-code" placeholder="Demo PIN" aria-label="Demo PIN" disabled={busy}
          onKeyDown={(e) => { if (e.key === "Enter") submit(e); }}
          style={{
            width: 130, fontSize: "var(--text-sm)", padding: "8px 12px",
            border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)",
          }}
        />
        <button type="submit" disabled={busy || !pin.trim()} style={{
          fontSize: "var(--text-sm)", fontWeight: 700, color: "#fff", background: "var(--blue-strong)",
          border: "none", borderRadius: "var(--radius)", padding: "8px 16px",
          cursor: busy || !pin.trim() ? "default" : "pointer", opacity: busy || !pin.trim() ? 0.6 : 1,
        }}>
          {busy ? "Checking…" : "Unlock"}
        </button>
      </div>
    </form>
  );
}
