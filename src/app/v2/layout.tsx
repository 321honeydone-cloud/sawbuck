import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "@/v2/v2.css";
import Shell from "@/v2/Shell";

// Sawbuck v2: the Option A UI (design/UI_SPEC.md). Lives beside the classic app
// and shares its database, login, AI routes and rate book.
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

// Installable app: its own manifest (id /v2) so it installs separately from the
// classic app, and opens straight to the job board.
export const metadata: Metadata = {
  title: "Sawbuck AI",
  applicationName: "Sawbuck AI",
  manifest: "/v2.webmanifest",
  icons: {
    icon: [
      { url: "/icons/v2-icon-32.png?v=1", type: "image/png", sizes: "32x32" },
      { url: "/icons/v2-icon-192.png?v=1", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/icons/v2-icon-180.png?v=1", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Sawbuck", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#161a21" },
  ],
};

// Apply the saved look before paint so there is no flash of the wrong theme.
const LOOK_INIT =
  "(function(){try{var r=document.getElementById('v2root');var m=localStorage.getItem('v2-mode');var a=localStorage.getItem('v2-accent');var b=localStorage.getItem('v2-bg');if(m==='light'||m==='dark')r.setAttribute('data-mode',m);if(a)r.setAttribute('data-accent',a);if(b)r.setAttribute('data-bg',b);}catch(e){}})();";

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div
      id="v2root"
      className={`v2 ${plex.variable} ${plexMono.variable}`}
      data-accent="harbor"
      data-bg="grad"
      suppressHydrationWarning
    >
      <script dangerouslySetInnerHTML={{ __html: LOOK_INIT }} />
      <Shell>{children}</Shell>
    </div>
  );
}
