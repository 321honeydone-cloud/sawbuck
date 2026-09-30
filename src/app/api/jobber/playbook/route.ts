// GET /api/jobber/playbook. The self heal playbook for the result sheet.
// Owner only.
import { NextResponse } from "next/server";
import { getSession, isAdmin } from "@/lib/session";
import { playbookStore } from "@/lib/jobberPush/server";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!isAdmin(session)) return NextResponse.json({ error: "owner_only" }, { status: 403 });
  return NextResponse.json(await playbookStore.load());
}
