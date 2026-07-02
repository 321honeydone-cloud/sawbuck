"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createEstimate } from "@/lib/createEstimate";
import FontScale from "./FontScale";
import { NAV_ITEMS, plusIcon, signOutIcon, I } from "./navItems";

// Mobile-only hamburger. Holds everything the old bottom bar carried: New,
// the nav links, text size, and Sign Out. Hidden on md+ where the rail lives.
export default function MobileMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAdmin(d.role === "admin"))
      .catch(() => {});
  }, []);

  // Close on route change and on Escape.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const onNew = async () => {
    setOpen(false);
    setCreating(true);
    const id = await createEstimate();
    if (id) router.push(`/estimate/${id}`);
    else setCreating(false);
  };

  const signOut = async () => {
    setOpen(false);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.replace("/login");
    router.refresh();
  };

  const rowBase = "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.07em] transition";

  return (
    <div className="relative md:hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted transition hover:border-brand/50 hover:text-brand"
      >
        <I className="h-5 w-5">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </I>
      </button>

      {open && (
        <>
          {/* Click-away backdrop */}
          <button
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-52 origin-top-right rounded-lg border border-border bg-card p-1.5 shadow-xl shadow-black/40"
          >
            <button
              onClick={onNew}
              disabled={creating}
              role="menuitem"
              className={`${rowBase} text-gold hover:bg-card-2 hover:text-brand-bright disabled:opacity-50`}
            >
              {plusIcon}
              New
            </button>

            {NAV_ITEMS.filter((i) => !i.adminOnly || admin).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                role="menuitem"
                className={`${rowBase} ${
                  item.match(pathname) ? "bg-card-2 text-brand" : "text-muted hover:bg-card-2 hover:text-ink"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}

            <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-border px-3 pb-1 pt-2.5">
              <span className="font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-muted">Text</span>
              <FontScale variant="mobile" />
            </div>

            <button
              onClick={signOut}
              role="menuitem"
              className={`${rowBase} mt-1.5 border-t border-border text-muted hover:bg-flag/10 hover:text-flag`}
            >
              {signOutIcon}
              Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
