// Server-only helper to read the current session from the request cookies.
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySession, type Session } from "./auth";

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return verifySession(store.get(COOKIE_NAME)?.value);
}

export const isAdmin = (s: Session | null) => s?.role === "admin";
