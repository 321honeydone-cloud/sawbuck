"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createEstimate } from "@/lib/createEstimate";
import { Icon, Seg, Toaster, toast, usePresence, useOutside } from "./ui";

type Mode = "system" | "light" | "dark";
type Backdrop = "flat" | "grad";
const SCHEMES = [
  { key: "harbor", name: "Harbor: petrol + amber", a: "#0d6e7a", b: "#f0a020" },
  { key: "honey", name: "HoneyDone: gold + steel", a: "#e3aa1e", b: "#3d6a8e" },
  { key: "field", name: "Field: green + yellow", a: "#1e8a57", b: "#f2b705" },
  { key: "americana", name: "Americana: blue + red", a: "#1f4fa8", b: "#c62f3a" },
  { key: "copper", name: "Copper + petrol", a: "#b8562b", b: "#0d6e7a" },
];

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

/** How deep a route is, so page changes slide the right way. */
const depth = (p: string) => (p.startsWith("/v2/job/") ? 1 : 0);

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<{ name: string; role: string } | null>(null);
  const [jobs, setJobs] = useState<{ id: string }[]>([]);
  const [shopOpen, setShopOpen] = useState(false);
  const [lookOpen, setLookOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("system");
  const [accent, setAccent] = useState("harbor");
  const [bg, setBg] = useState<Backdrop>("grad");
  const [creating, setCreating] = useState(false);

  // Slide direction for the page that just mounted.
  const prevDepth = useRef(depth(pathname));
  const [dir, setDir] = useState<"fwd" | "back" | "">("");
  useEffect(() => {
    const d = depth(pathname);
    setDir(d > prevDepth.current ? "fwd" : d < prevDepth.current ? "back" : "");
    prevDepth.current = d;
  }, [pathname]);

  useEffect(() => {
    const m = read("v2-mode");
    if (m === "light" || m === "dark") setMode(m);
    const a = read("v2-accent");
    if (a && SCHEMES.some((s) => s.key === a)) setAccent(a);
    const b = read("v2-bg");
    if (b === "flat" || b === "grad") setBg(b);
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMe({ name: d.name, role: d.role }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/estimate")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.estimates && setJobs(d.estimates))
      .catch(() => {});
  }, [pathname]);

  useEffect(() => {
    const r = document.getElementById("v2root");
    if (!r) return;
    if (mode === "system") r.removeAttribute("data-mode");
    else r.setAttribute("data-mode", mode);
    r.setAttribute("data-accent", accent);
    r.setAttribute("data-bg", bg);
    write("v2-mode", mode);
    write("v2-accent", accent);
    write("v2-bg", bg);
  }, [mode, accent, bg]);

  const newJob = async () => {
    if (creating) return;
    setCreating(true);
    const id = await createEstimate();
    setCreating(false);
    if (id) router.push(`/v2/job/${id}`);
    else toast("Could not start a new job. Try again.");
  };

  const askAi = async () => {
    if (pathname.startsWith("/v2/job/")) {
      document.querySelector<HTMLTextAreaElement>(".v2 .cbox textarea")?.focus();
      return;
    }
    if (jobs[0]) router.push(`/v2/job/${jobs[0].id}`);
    else await newJob();
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  };

  const shopRef = useRef<HTMLDivElement>(null);
  const closeShop = useCallback(() => setShopOpen(false), []);
  useOutside(shopRef, shopOpen, closeShop);
  const lookRef = useRef<HTMLDivElement>(null);
  const closeLook = useCallback(() => setLookOpen(false), []);
  useOutside(lookRef, lookOpen, closeLook);
  const shop = usePresence(shopOpen, 150);
  const look = usePresence(lookOpen, 150);
  const isAdmin = me?.role === "admin";
  const onJobs = pathname === "/v2" || pathname.startsWith("/v2/job");

  return (
    <>
      <nav className="rail" aria-label="Main">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src="/logo.png" alt="Sawbuck" />
        <button className="rbtn new" onClick={newJob} disabled={creating} title="New job" aria-label="New job">
          {Icon.plus}
        </button>
        <Link href="/v2" className={`rbtn jobs${onJobs ? " on" : ""}`}>
          {Icon.grid}
          <span>Jobs</span>
          {jobs.length > 0 && <b className="count">{jobs.length}</b>}
        </Link>
        <button className="rbtn" onClick={askAi}>
          {Icon.spark}
          <span>Ask AI</span>
        </button>
        <div className="spacer" />
        <div ref={shopRef}>
          <button className={`rbtn${shopOpen ? " on" : ""}`} onClick={() => setShopOpen((o) => !o)} aria-haspopup="menu" aria-expanded={shopOpen}>
            {Icon.gear}
            <span>Shop</span>
          </button>
          {shop.render && (
            <div className={`menu shopmenu ${shop.closing ? "pop-out" : "pop-in"}`} role="menu">
              {isAdmin && (
                <Link href="/ratebook" role="menuitem">
                  Rate book <small>classic</small>
                </Link>
              )}
              <Link href="/inspect" role="menuitem">
                Scout inspections <small>classic</small>
              </Link>
              {isAdmin && (
                <Link href="/admin" role="menuitem">
                  Crew and admin <small>classic</small>
                </Link>
              )}
              <button
                role="menuitem"
                onClick={() => {
                  setShopOpen(false);
                  setLookOpen(true);
                }}
              >
                Appearance
              </button>
              <hr />
              <Link href="/history" role="menuitem">
                Open classic Sawbuck
              </Link>
              <button role="menuitem" onClick={signOut}>
                Sign out <small>{me?.name ?? ""}</small>
              </button>
            </div>
          )}
        </div>
        {look.render && (
          <div ref={lookRef} className={`menu look ${look.closing ? "pop-out" : "pop-in"}`} role="dialog" aria-label="Appearance">
            <div className="lrow">
              <span className="label">Mode</span>
              <Seg<Mode>
                label="Mode"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "system", label: "Auto" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
              />
            </div>
            <div className="lrow">
              <span className="label">Scheme</span>
              {SCHEMES.map((s) => (
                <button
                  key={s.key}
                  className={`swatch${accent === s.key ? " on" : ""}`}
                  title={s.name}
                  aria-label={s.name}
                  style={{ background: `linear-gradient(135deg, ${s.a} 50%, ${s.b} 50%)` }}
                  onClick={() => setAccent(s.key)}
                />
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>{SCHEMES.find((s) => s.key === accent)?.name}</div>
            <div className="lrow">
              <span className="label">Backdrop</span>
              <Seg<Backdrop>
                label="Backdrop"
                value={bg}
                onChange={setBg}
                options={[
                  { value: "flat", label: "Flat" },
                  { value: "grad", label: "Two-tone" },
                ]}
              />
            </div>
          </div>
        )}
      </nav>
      <main className="main">
        <div key={pathname} className={`page${dir ? ` v-in-${dir}` : ""}`}>
          {children}
        </div>
      </main>
      <Toaster />
    </>
  );
}
