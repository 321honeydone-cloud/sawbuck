"use client";

import { useEffect, useState } from "react";

// Branded loading splash shown on cold open (a fresh page load / app launch).
// Matches the desktop launcher splash so the handoff from the app icon is
// seamless. Fades out after a brief beat, then unmounts.
export default function Splash() {
  const [hidden, setHidden] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setHidden(true), 900);
    const t2 = setTimeout(() => setGone(true), 1450);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (gone) return null;

  return (
    <div
      aria-hidden
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-[#0a0a0c] transition-opacity duration-500 ${
        hidden ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/sawbuck-lockup.png?v=2" alt="Sawbuck AI" className="w-[min(82vw,760px)]" />
      <div className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-[#FED811]/10">
        <div className="splash-bar h-full w-1/4 bg-gradient-to-r from-transparent via-[#FED811] to-transparent" />
      </div>
    </div>
  );
}
