"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createEstimate } from "@/lib/createEstimate";
import FontScale from "./FontScale";
import { NAV_ITEMS, plusIcon, signOutIcon } from "./navItems";

// Desktop-only icon rail. On mobile the nav collapses into the hamburger
// (see MobileMenu), which is wired up by AppFrame and the estimate top bar.
export default function Nav() {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAdmin(d.role === "admin"))
      .catch(() => {});
  }, []);

  const onNew = async () => {
    setCreating(true);
    const id = await createEstimate();
    if (id) {
      // router.push onto the same URL (when the server reuses an existing empty
      // draft) is a no-op, which made the button look dead. refresh() forces the
      // route to re-render either way, so New always lands on a clean draft.
      router.push(`/estimate/${id}`);
      router.refresh();
    }
    setCreating(false);
  };

  const signOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.replace("/login");
    router.refresh();
  };

  const itemBase = "flex flex-col items-center gap-1 rounded-md px-2 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.07em] transition";
  const cls = (active: boolean) => `${itemBase} ${active ? "text-brand" : "text-muted hover:text-ink"}`;

  return (
    <nav className="hidden w-[4.9rem] shrink-0 flex-col items-center gap-1.5 overflow-hidden border-r border-border bg-card py-3 backdrop-blur-sm md:flex">
      <div className="mb-2">
        <img src="/logo.png" alt="Sawbuck AI" className="h-9 w-9 object-contain" />
      </div>

      <button onClick={onNew} disabled={creating} className={`${itemBase} text-gold hover:text-brand-bright`} aria-label="New estimate">
        {plusIcon}
        New
      </button>

      {NAV_ITEMS.filter((i) => !i.adminOnly || admin).map((item) => (
        <Link key={item.href} href={item.href} className={cls(item.match(pathname))}>
          {item.icon}
          {item.label}
        </Link>
      ))}

      <div className="flex-1" />
      <FontScale />
      <button onClick={signOut} className={`${itemBase} text-muted hover:text-ink`} aria-label="Sign out">
        {signOutIcon}
        Sign Out
      </button>
    </nav>
  );
}
