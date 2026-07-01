"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Nav from "./Nav";
import FeedbackWidget from "./FeedbackWidget";
import { rateBook, setRateBookTasks } from "@/lib/loadRateBook";
import { applyOverrides } from "@/lib/rateOverrides";

// Estimator-first shell: slim icon rail on desktop, bottom tab bar on mobile.
// The login keypad renders bare (no nav).
export default function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Layer Manny's saved rate-book edits onto the live flat-rate engine so chat
  // quotes use his prices. Non-admin sessions get 403 here and stay on the base
  // book, which is fine. Runs once per app load.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ratebook")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.overrides && Object.keys(d.overrides).length > 0) {
          setRateBookTasks(applyOverrides(rateBook.tasks, d.overrides));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (pathname === "/login") return <>{children}</>;
  return (
    <div className="flex h-screen flex-col overflow-hidden md:flex-row">
      <Nav variant="desktop" />
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
      <Nav variant="mobile" />
      <FeedbackWidget />
    </div>
  );
}
