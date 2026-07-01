// User feedback. Any signed-in user can POST a note. The admin GETs the list.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { message?: string; page?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const message = String(body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "empty" }, { status: 400 });
  await prisma.feedback.create({
    data: {
      userId: session.uid,
      userName: session.name,
      role: session.role,
      message: message.slice(0, 4000),
      page: String(body.page ?? "").slice(0, 200) || null,
    },
  });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const feedback = await prisma.feedback.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return NextResponse.json({ feedback });
}
