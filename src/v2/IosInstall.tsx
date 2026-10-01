"use client";

import { useEffect } from "react";
import { usePresence } from "./ui";

/** iPhone Safari has no install button, so walk through Share, Add to Home Screen. */
export default function IosInstall({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { render, closing } = usePresence(open, 180);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!render) return null;
  return (
    <div className={`overlay${closing ? " out" : ""}`} onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Install Sawbuck" style={{ width: "min(440px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>Install Sawbuck</h3>
          <button className="btn ghost sm" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dbody">
          <ol className="iossteps">
            <li>
              Open Sawbuck in <b>Safari</b> (or Chrome on Android).
            </li>
            <li>
              Tap the <b>Share</b> button{" "}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
              </svg>{" "}
              at the bottom of the screen.
            </li>
            <li>
              Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.
            </li>
          </ol>
          <span className="muted" style={{ fontSize: 13 }}>
            Sawbuck then opens full screen from its own icon, like any other app.
          </span>
        </div>
      </div>
    </div>
  );
}
