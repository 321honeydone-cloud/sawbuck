"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Nav from "./Nav";
import MobileMenu from "./MobileMenu";
import FeedbackWidget from "./FeedbackWidget";
import ClaudeUsageGuard from "./ClaudeUsageGuard";
import { rateBook, setRateBookTasks } from "@/lib/loadRateBook";
import { applyOverrides } from "@/lib/rateOverrides";

// Estimator-first shell: slim icon rail on desktop, hamburger menu on mobile.
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

  // The estimate screen hosts the hamburger in its own top bar (next to
  // Delete + Status), so we skip the shared mobile bar there to avoid stacking.
  const showMobileBar = !pathname.startsWith("/estimate/");

  return (
    // h-dvh, not h-screen: 100vh lies on mobile when the browser address bar
    // shows/hides, which pushed the input bar off screen and broke scrolling.
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <Nav />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {showMobileBar && (
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-2 backdrop-blur-sm md:hidden">
            <img src="/logo.png" alt="Sawbuck AI" className="h-7 w-7 object-contain" />
            <MobileMenu />
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
      <FeedbackWidget />
      <ClaudeUsageGuard />
    </div>
  );
}
