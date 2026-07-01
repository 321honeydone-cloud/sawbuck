"use client";

import { useEffect, useState } from "react";

// Three text-size settings. Persists in localStorage and drives the
// data-fontscale attribute on <html>, which scales rem-based type app-wide.
// The initial attribute is set by an inline script in layout.tsx (no flash).
type Scale = "small" | "regular" | "large";

const OPTS: { key: Scale; px: number; title: string }[] = [
  { key: "small", px: 10, title: "Small text" },
  { key: "regular", px: 12, title: "Regular text" },
  { key: "large", px: 14, title: "Large text" },
];

export default function FontScale({ variant = "desktop" }: { variant?: "desktop" | "mobile" }) {
  const [scale, setScale] = useState<Scale>("regular");

  useEffect(() => {
    const cur = document.documentElement.getAttribute("data-fontscale");
    if (cur === "small" || cur === "regular" || cur === "large") setScale(cur);
  }, []);

  const pick = (s: Scale) => {
    setScale(s);
    document.documentElement.setAttribute("data-fontscale", s);
    try {
      localStorage.setItem("hd-fontscale", s);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex flex-col items-center gap-1">
      {variant === "desktop" && (
        <span className="font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-muted">Text</span>
      )}
      <div className="flex items-end gap-0.5" role="group" aria-label="Text size">
        {OPTS.map((o) => {
          const on = o.key === scale;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => pick(o.key)}
              aria-pressed={on}
              title={o.title}
              className={`flex h-6 w-5 items-center justify-center rounded border font-display font-semibold leading-none transition ${
                on ? "border-brand/60 bg-brand/10 text-brand" : "border-border text-muted hover:text-ink"
              }`}
              style={{ fontSize: `${o.px / 16}rem` }}
            >
              A
            </button>
          );
        })}
      </div>
    </div>
  );
}
