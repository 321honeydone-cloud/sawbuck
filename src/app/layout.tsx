import type { Metadata, Viewport } from "next";
import { Oswald, Barlow, Space_Mono } from "next/font/google";
import "./globals.css";
import AppFrame from "@/components/AppFrame";
import Splash from "@/components/Splash";
import PwaInit from "@/components/PwaInit";

const oswald = Oswald({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-oswald" });
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-barlow" });
const spaceMono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-space-mono" });

export const metadata: Metadata = {
  title: "Sawbuck AI",
  description: "Describe a job in plain English and watch the estimate build itself.",
  applicationName: "Sawbuck AI",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico?v=3", sizes: "any" },
      { url: "/icons/icon-192.png?v=3", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon-512.png?v=3", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icons/icon-180.png?v=3", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Sawbuck AI" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0c",
};

// Sets the saved text size before paint so there is no flash of resized type.
const FONTSCALE_INIT =
  "(function(){try{var s=localStorage.getItem('hd-fontscale');if(s!=='small'&&s!=='regular'&&s!=='large'){s='regular';}document.documentElement.setAttribute('data-fontscale',s);}catch(e){document.documentElement.setAttribute('data-fontscale','regular');}})();";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${oswald.variable} ${barlow.variable} ${spaceMono.variable}`}>
      <body className="font-sans antialiased">
        <script dangerouslySetInnerHTML={{ __html: FONTSCALE_INIT }} />
        <Splash />
        <PwaInit />
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
