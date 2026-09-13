import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

const ThemeContext = createContext();

// ─────────────────────────────────────────────────────────────────────────────
// THEME (TASK-53)
//
// Three choices, but only two appearances. "auto" is a PREFERENCE, not a look:
// it defers to whatever the operating system is set to, which is what a Mac,
// a Windows machine or a phone already knows about its owner. Light and dark
// are explicit overrides for the person who wants this one app to differ.
//
// So two values travel together and they are not the same thing:
//   theme     what the user asked for: "auto" | "light" | "dark"
//   resolved  what is actually painted: "light" | "dark"
//
// Auto is the default because it is the only option that is right without being
// chosen. Light remains the fallback, and it is a real fallback rather than a
// theoretical one: a browser with no matchMedia, a locked-down webview, or an
// OS that reports nothing all land there. Dark is never reached by accident.
// ─────────────────────────────────────────────────────────────────────────────

export const THEMES = [
  { id: "auto",  label: "Auto",  icon: "🖥️" },
  { id: "light", label: "Light", icon: "☀️" },
  { id: "dark",  label: "Dark",  icon: "🌙" },
];

const VALID_IDS = THEMES.map((t) => t.id);

const DARK_QUERY = "(prefers-color-scheme: dark)";

// Everything here is wrapped, because each of these can throw rather than
// return a falsy value. Safari in a private window throws on localStorage, and
// matchMedia is absent in some embedded webviews. A theme lookup must never be
// the reason the app fails to mount.
function systemPrefersDark() {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false; // Cannot tell, so light. See the note above.
  }
}

// A new key on purpose. Earlier versions wrote "light" to localStorage on every
// mount, including for people who never opened the theme menu, so an existing
// stored "light" cannot be trusted to mean "this user chose light". Reading a
// fresh key lets everyone land on Auto once, after which a stored value really
// does mean somebody picked it.
const STORAGE_KEY = "theme.v2";

function storedTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return VALID_IDS.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => storedTheme() || "auto");
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // The OS setting can change while the app is open, and on a Mac it does:
  // the appearance follows sunset if "Auto" is set in System Settings. Without
  // this listener the app would only catch up on reload.
  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia(DARK_QUERY);
    } catch {
      return;
    }
    if (!mq || typeof mq.addEventListener !== "function") return;
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved = theme === "auto" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    // Light is the empty string rather than "light", which is the convention
    // the stylesheet was built around: :root holds the light palette and
    // [data-theme="dark"] overrides it.
    document.documentElement.setAttribute("data-theme", resolved === "dark" ? "dark" : "");
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* private mode, not fatal */ }
  }, [theme, resolved]);

  const choose = useCallback((id) => {
    if (VALID_IDS.includes(id)) setTheme(id);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme: choose }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
