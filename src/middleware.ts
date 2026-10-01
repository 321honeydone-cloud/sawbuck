import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, verifySession } from "@/lib/auth";

// Gate every route behind a valid signed session. /login and /api/auth/* stay
// open so a signed-out visitor can reach the keypad and authenticate.
export async function middleware(req: NextRequest) {
  const session = await verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (session) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

// Public static files stay open too: Chrome fetches the install manifest, the
// service worker and the app icons without the login cookie, so gating them
// would redirect to /login and make the app uninstallable.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|login|api/auth|api/cron|api/memory|uploads|sw\\.js|manifest\\.webmanifest|v2\\.webmanifest|offline\\.html|icons/|screens/|logo\\.png|sawbuck-lockup\\.png).*)",
  ],
};
