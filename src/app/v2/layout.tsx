import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "@/v2/v2.css";
import Shell from "@/v2/Shell";

// Sawbuck v2: the Option A UI (design/UI_SPEC.md). Lives beside the classic app
// and shares its database, login, AI routes and rate book.
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

export const metadata: Metadata = { title: "Sawbuck" };

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
