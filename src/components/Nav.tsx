"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createEstimate } from "@/lib/createEstimate";
import FontScale from "./FontScale";

type Variant = "desktop" | "mobile";

function I({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const askIcon = <I><path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 16l-1.7-5L6 9.3l4.3-1.7z" /><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" /></I>;
const listIcon = <I><circle cx="5" cy="7" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="5" cy="17" r="1" /><line x1="9" y1="7" x2="20" y2="7" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="17" x2="20" y2="17" /></I>;
const adminIcon = <I><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /></I>;
const rateIcon = <I><path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-6.6-6.6a2 2 0 01-.6-1.4V5a2 2 0 012-2h7.2a2 2 0 011.4.6l6.6 6.6a2 2 0 010 2.8z" /><circle cx="8" cy="8" r="1.4" /></I>;
const scoutIcon = <I><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 13l2 2 4-4" /></I>;
const plusIcon = <I><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></I>;
const lockIcon = <I><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></I>;

export default function Nav({ variant }: { variant: Variant }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAdmin(d.role === "admin"))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNew = async () => {
    setCreating(true);
    const id = await createEstimate();
    if (id) router.push(`/estimate/${id}`);
    else setCreating(false);
  };
  const lock = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.replace("/login");
    router.refresh();
  };

  const onEstimator = pathname === "/" || pathname.startsWith("/estimate");
  const itemBase = "flex flex-col items-center gap-1 rounded-md px-2 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.07em] transition";
  const cls = (active: boolean) => `${itemBase} ${active ? "text-brand" : "text-muted hover:text-ink"}`;

  const items = (
    <>
      <button onClick={onNew} disabled={creating} className={`${itemBase} text-gold hover:text-brand-bright`} aria-label="New estimate">
        {plusIcon}
        New
      </button>
      <Link href="/" className={cls(onEstimator)}>
        {askIcon}
        Ask AI
      </Link>
      <Link href="/inspect" className={cls(pathname.startsWith("/inspect"))}>
        {scoutIcon}
        Inspect
      </Link>
      <Link href="/history" className={cls(pathname.startsWith("/history"))}>
        {listIcon}
        Quotes
      </Link>
      {admin && (
        <>
          <Link href="/ratebook" className={cls(pathname.startsWith("/ratebook"))}>
            {rateIcon}
            Rates
          </Link>
          <Link href="/admin" className={cls(pathname.startsWith("/admin"))}>
            {adminIcon}
            Admin
          </Link>
        </>
      )}
    </>
  );

  if (variant === "mobile") {
    return (
      <nav className="flex items-center justify-around border-t border-border bg-card px-1 py-1 backdrop-blur-sm md:hidden">
        {items}
        <FontScale variant="mobile" />
        <button onClick={lock} className={`${itemBase} text-muted hover:text-ink`} aria-label="Lock">
          {lockIcon}
          Lock
        </button>
      </nav>
    );
  }

  return (
    <nav className="hidden w-[4.9rem] shrink-0 flex-col items-center gap-1.5 overflow-hidden border-r border-border bg-card py-3 backdrop-blur-sm md:flex">
      <div className="mb-2">
        <img src="/logo.png" alt="Sawbuck AI" className="h-9 w-9 object-contain" />
      </div>
      {items}
      <div className="flex-1" />
      <FontScale />
      <button onClick={lock} className={`${itemBase} text-muted hover:text-ink`} aria-label="Lock">
        {lockIcon}
        Lock
      </button>
    </nav>
  );
}
