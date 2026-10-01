"use client";

// Install-to-home-screen state. Chrome (Android and desktop) fires
// beforeinstallprompt once the app qualifies, so we hold that event and show our
// own Install button. iPhone Safari has no prompt, so we show the Share,
// Add to Home Screen steps instead. Nothing shows once it runs as an installed app.

import { useSyncExternalStore } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export interface InstallState {
  canPrompt: boolean; // Chrome is holding an install prompt for us
  installed: boolean; // already running as the installed app
  ios: boolean; // iPhone or iPad, where install is manual
}

const SERVER: InstallState = { canPrompt: false, installed: false, ios: false };
let deferred: InstallPromptEvent | null = null;
let snap: InstallState = SERVER;
const subs = new Set<() => void>();

function standalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
function isIos() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}
function update(installedNow?: boolean) {
  snap = { canPrompt: !!deferred, installed: installedNow ?? standalone(), ios: isIos() };
  subs.forEach((f) => f());
}

if (typeof window !== "undefined") {
  snap = { canPrompt: false, installed: standalone(), ios: isIos() };
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own button instead of Chrome's mini bar
    deferred = e as InstallPromptEvent;
    update();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    update(true);
  });
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export function useInstall(): InstallState {
  return useSyncExternalStore(subscribe, () => snap, () => SERVER);
}

/** Show Chrome's install dialog. Resolves true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  await e.prompt();
  const choice = await e.userChoice.catch(() => ({ outcome: "dismissed" as const }));
  deferred = null;
  update(choice.outcome === "accepted" ? true : undefined);
  return choice.outcome === "accepted";
}
