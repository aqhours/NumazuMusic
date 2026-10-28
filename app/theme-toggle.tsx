"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const sync = () => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    sync();
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("numazumusic-theme", nextTheme); } catch { /* Theme still works without storage. */ }
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    setTheme(nextTheme);
  };

  return <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "切换到浅色模式" : "切换到暗色模式"} aria-pressed={theme === "dark"} data-umami-event="theme-change" data-umami-event-theme={theme === "dark" ? "light" : "dark"}>
    <Moon className="theme-icon theme-icon-moon" aria-hidden="true" />
    <Sun className="theme-icon theme-icon-sun" aria-hidden="true" />
  </button>;
}
