"use client";

// Small shared pieces for the v2 UI: presence (animate out before unmount),
// sliding segmented control, sliding tab ink, toasts, icons.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Keep something mounted long enough to play its exit animation. */
export function usePresence(open: boolean, ms = 160) {
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setRender(true);
      setClosing(false);
      return;
    }
    if (!render) return;
    setClosing(true);
    const t = setTimeout(() => {
      setRender(false);
      setClosing(false);
    }, reducedMotion() ? 0 : ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return { render, closing };
}

/** Close a popover when clicking anywhere outside the given element. */
export function useOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [ref, open, onClose]);
}

/** Positions a marker (tab ink or seg thumb) under the active child. */
export function useMarker(dep: unknown) {
  const box = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLElement>(null);
  const ready = useRef(false);
  const place = useCallback(() => {
    const c = box.current;
    const m = mark.current;
    if (!c || !m) return;
    const on = c.querySelector<HTMLElement>(":scope > button.on, :scope > a.on");
    if (!on || !c.offsetWidth) return;
    if (!ready.current) m.classList.add("noanim");
    m.style.width = `${on.offsetWidth}px`;
    m.style.transform = `translateX(${on.offsetLeft}px)`;
    if (!ready.current) {
      void m.offsetWidth;
      m.classList.remove("noanim");
      ready.current = true;
    }
  }, []);
  useLayoutEffect(place, [dep, place]);
  useEffect(() => {
    const ro = new ResizeObserver(place);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [place]);
  return { box, mark };
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  const { box, mark } = useMarker(value);
  return (
    <div className="seg" ref={box} role="radiogroup" aria-label={label}>
      <i className="thumb" ref={mark} />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- toasts ---------- */
export function toast(message: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("v2toast", { detail: message }));
}

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  const [out, setOut] = useState(false);
  useEffect(() => {
    let t1: ReturnType<typeof setTimeout>, t2: ReturnType<typeof setTimeout>;
    const h = (e: Event) => {
      clearTimeout(t1);
      clearTimeout(t2);
      setOut(false);
      setMsg(String((e as CustomEvent).detail));
      t1 = setTimeout(() => {
        setOut(true);
        t2 = setTimeout(() => setMsg(null), 200);
      }, 2400);
    };
    window.addEventListener("v2toast", h);
    return () => {
      window.removeEventListener("v2toast", h);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  if (!msg) return null;
  return (
    <div className={`toast${out ? " out" : ""}`} role="status" key={msg}>
      {msg}
    </div>
  );
}

/* ---------- icons ---------- */
const S = ({ children, w = 2 }: { children: ReactNode; w?: number }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
export const Icon = {
  plus: <S w={2.4}><path d="M12 5v14M5 12h14" /></S>,
  grid: <S w={1.8}><rect x="3" y="4" width="7" height="7" /><rect x="14" y="4" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></S>,
  spark: <S w={1.8}><path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 16l-1.7-5L6 9.3l4.3-1.7z" /></S>,
  gear: <S w={1.8}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></S>,
  search: <S w={2.2}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></S>,
  x: <S w={2.4}><path d="M6 6l12 12M18 6L6 18" /></S>,
  chev: <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>,
  left: <S w={2.2}><path d="M15 18l-6-6 6-6" /></S>,
  right: <S w={2.4}><path d="M9 6l6 6-6 6" /></S>,
  pin: <S><path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></S>,
  doc: <S><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></S>,
  clip: <S w={1.8}><path d="M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7" /></S>,
  mic: <S w={1.8}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></S>,
  send: <S w={2}><path d="M4 12l16-8-6 16-2-7z" /></S>,
  trash: <S w={1.8}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></S>,
};

export const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

export const moneyWhole = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Count a number up or down to its new value. */
export function useTween(target: number, ms = 360) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (reducedMotion() || Math.abs(start - target) < 0.5) {
      setV(target);
      from.current = target;
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const cur = start + (target - start) * e;
      from.current = cur;
      setV(cur);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
