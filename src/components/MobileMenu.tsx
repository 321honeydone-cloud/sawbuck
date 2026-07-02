"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createEstimate } from "@/lib/createEstimate";
import FontScale from "./FontScale";
import { NAV_ITEMS, plusIcon, signOutIcon, I } from "./navItems";

// Mobile-only hamburger. Holds everything the old bottom bar carried: New,
// the nav links, text size, and Sign Out. Hidden on md+ where the rail lives.
//
// The dropdown is rendered through a portal to <body> so it escapes the top
// bar's stacking context (the bar uses backdrop-blur, which traps absolutely
// positioned children behind the sticky estimate pricing header). Portaling
// lets it sit above everything, and the backdrop blurs the page behind it.
export default function MobileMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; right: number }>({ top: 56, right: 12 });

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAdmin(d.role === "admin"))
      .catch(() => {});
  }, []);

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Anchor the panel under the button, and keep it aligned on resize. Close on
  // Escape.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setCoords({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", place);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Mount on open; on close, play the exit then unmount.
  useEffect(() => {
    if (open) {
      setVisible(true);
      return;
    }
    setShown(false);
    const t = setTimeout(() => setVisible(false), 380);
    return () => clearTimeout(t);
  }, [open]);

  // Once mounted, force the browser to commit the collapsed (scale .6 / opacity 0)
  // state, then flip to shown so the spring pop has a real "from" frame to
  // transition from. Without the forced reflow a freshly mounted node snaps
  // straight to open (open wouldn't animate, only close did).
  useEffect(() => {
    if (!visible) return;
    const r = requestAnimationFrame(() => {
      if (panelRef.current) void panelRef.current.offsetWidth; // reflow: lock in the from-state
      setShown(true);
    });
    return () => cancelAnimationFrame(r);
  }, [visible]);

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

  const menu =
    mounted && visible
      ? createPortal(
          <div className="md:hidden">
            {/* Blurred click-away backdrop */}
            <button
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className={`fixed inset-0 z-[90] cursor-default bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
                shown ? "opacity-100" : "opacity-0"
              }`}
            />
            <div
              ref={panelRef}
              role="menu"
              style={{ top: coords.top, right: coords.right }}
              className={`fixed z-[100] w-52 origin-top-right rounded-lg border border-border bg-card p-1.5 shadow-xl shadow-black/50 transition-[opacity,transform] duration-[380ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                shown ? "scale-100 opacity-100" : "scale-[0.6] opacity-0"
              }`}
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
          </div>,
          document.body
        )
      : null;

  return (
    <div className="relative md:hidden">
      <button
        ref={btnRef}
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
      {menu}
    </div>
  );
}
