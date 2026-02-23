"use client";

import { useEffect, useState, startTransition } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "system" | "light" | "dark";

const CYCLE: Theme[] = ["system", "light", "dark"];

const NEXT_THEME: Record<Theme, Theme> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const ICONS: Record<Theme, React.ReactNode> = {
  system: <Monitor className="h-4 w-4" aria-hidden="true" />,
  light: <Sun className="h-4 w-4" aria-hidden="true" />,
  dark: <Moon className="h-4 w-4" aria-hidden="true" />,
};

const LABELS: Record<Theme, string> = {
  system: "system",
  light: "light",
  dark: "dark",
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { startTransition(() => setMounted(true)); }, []);

  // Render a placeholder until mounted so server and client agree on initial HTML.
  if (!mounted) {
    return <div className="h-9 w-9" />;
  }

  const current = (CYCLE.includes(theme as Theme) ? theme : "system") as Theme;
  const next = NEXT_THEME[current];

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${LABELS[next]} theme`}
      className="inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {ICONS[current]}
    </button>
  );
}
