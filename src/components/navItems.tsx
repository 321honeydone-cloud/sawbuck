import type { ReactNode } from "react";

// Shared nav icons + item list. Both the desktop rail (Nav) and the mobile
// hamburger (MobileMenu) render from this so the two never drift.

export function I({ children, className = "h-6 w-6" }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const askIcon = <I><path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 16l-1.7-5L6 9.3l4.3-1.7z" /><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" /></I>;
export const listIcon = <I><circle cx="5" cy="7" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="5" cy="17" r="1" /><line x1="9" y1="7" x2="20" y2="7" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="17" x2="20" y2="17" /></I>;
export const adminIcon = <I><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /></I>;
export const rateIcon = <I><path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-6.6-6.6a2 2 0 01-.6-1.4V5a2 2 0 012-2h7.2a2 2 0 011.4.6l6.6 6.6a2 2 0 010 2.8z" /><circle cx="8" cy="8" r="1.4" /></I>;
export const scoutIcon = <I><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 13l2 2 4-4" /></I>;
export const plusIcon = <I><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></I>;
export const signOutIcon = <I><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><path d="M16 17l5-5-5-5" /><line x1="21" y1="12" x2="9" y2="12" /></I>;

export type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
  match: (path: string) => boolean;
};

// Order mirrors the old bottom bar / desktop rail (minus the New button, which
// is rendered separately because it isn't a route link).
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Ask AI", icon: askIcon, match: (p) => p === "/" || p.startsWith("/estimate") },
  { href: "/inspect", label: "Inspect", icon: scoutIcon, match: (p) => p.startsWith("/inspect") },
  { href: "/history", label: "Quotes", icon: listIcon, match: (p) => p.startsWith("/history") },
  { href: "/ratebook", label: "Rates", icon: rateIcon, adminOnly: true, match: (p) => p.startsWith("/ratebook") },
  { href: "/admin", label: "Admin", icon: adminIcon, adminOnly: true, match: (p) => p.startsWith("/admin") },
];
