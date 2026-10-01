"use client";

import { useEffect, useState } from "react";
import { reducedMotion } from "./ui";

/** The Sawbuck lockup, straight from the logo PNG. Small sits on a dark badge so
 *  the white wordmark reads in light mode too. */
export function Lockup({ size = "lg" }: { size?: "lg" | "sm" }) {
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img className={size === "lg" ? "lk-full" : undefined} src="/sawbuck-lockup.png?v=2" alt="Sawbuck AI. Estimates, done." />;
  return size === "lg" ? img : <span className="lk-badge">{img}</span>;
}

/** Branded loading screen on a cold open (app launch or full page load). */
export default function Splash() {
  const [phase, setPhase] = useState<"show" | "hide" | "gone">("show");
  useEffect(() => {
    const hold = reducedMotion() ? 150 : 950;
    const t1 = setTimeout(() => setPhase("hide"), hold);
    const t2 = setTimeout(() => setPhase("gone"), hold + 460);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  if (phase === "gone") return null;
  return (
    <div className={`splash${phase === "hide" ? " out" : ""}`} role="status" aria-label="Loading Sawbuck">
      <Lockup />
      <div className="splash-bar" aria-hidden>
        <i />
      </div>
    </div>
  );
}

/** In-app loading state while a screen fetches its data. */
export function RouteLoader({ label }: { label: string }) {
  return (
    <div className="routeload" role="status">
      <div className="splash-bar top" aria-hidden>
        <i />
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="rl-mark" src="/icons/v2-maskable-192.png?v=1" alt="" />
      <span>{label}</span>
    </div>
  );
}
