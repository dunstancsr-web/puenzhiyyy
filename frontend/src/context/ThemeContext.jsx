import React, { createContext, useContext, useState, useEffect } from "react";

const ThemeContext = createContext();

export const THEMES = [
  { id: "light", label: "Light", icon: "☀️" },
  { id: "dark",  label: "Dark",  icon: "🌙" },
];

const VALID_IDS = THEMES.map((t) => t.id);

export function ThemeProvider({ children }) {
  // Falls back to "light" for anything not currently offered. Covers a
  // browser that still has an old theme (e.g. the removed "glass") saved.
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem("theme");
    return VALID_IDS.includes(stored) ? stored : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme === "light" ? "" : theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
