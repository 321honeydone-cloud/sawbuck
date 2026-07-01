"use client";

import { useEffect } from "react";

// Registers the service worker so Chrome can install HoneyDone as an app.
export default function PwaInit() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* ignore: install just falls back to a normal browser tab */
      });
    }
  }, []);
  return null;
}
