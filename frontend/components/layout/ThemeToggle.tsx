"use client";

import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "@tabler/icons-react";

type Theme = "dark" | "light";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const saved = (typeof window !== "undefined" && (localStorage.getItem("theme") as Theme)) || "dark";
    setTheme(saved);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", next);
    }
    if (typeof window !== "undefined") {
      localStorage.setItem("theme", next);
    }
  };

  return (
    <button onClick={toggle} className="relative p-2 rounded-lg hover:bg-border transition-colors" aria-label={theme === "dark" ? "Alternar para modo claro" : "Alternar para modo escuro"}>
      {theme === "dark" ? <IconSun className="h-5 w-5 text-text" /> : <IconMoon className="h-5 w-5 text-text" />}
    </button>
  );
}
