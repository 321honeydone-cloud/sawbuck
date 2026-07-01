import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { hashPin } from "@/lib/auth";

export const runtime = "nodejs";

async function isAdminReq() {
  const s = await getSession();
  return s?.role === "admin";
}

// GET /api/admin/users — list users (admin only).
export async function GET() {
  if (!(await isAdminReq())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const users = await prisma.user.findMany({
    select: { id: true, name: true, role: true, createdAt: true, pin: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ users });
}

// POST /api/admin/users { name, pin, role } — add a user (admin only).
export async function POST(req: Request) {
  if (!(await isAdminReq())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: { name?: string; pin?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  const pin = (body.pin ?? "").trim();
  const role = body.role === "admin" ? "admin" : "user";
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (!/^\d{4,8}$/.test(pin)) return NextResponse.json({ error: "pin_format" }, { status: 400 });

  try {
    const user = await prisma.user.create({ data: { name, pin, pinHash: await hashPin(pin), role } });
    return NextResponse.json({ user: { id: user.id, name: user.name, role: user.role } }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "pin_in_use" }, { status: 409 });
  }
}

// DELETE /api/admin/users { id } — remove a user (admin only).
export async function DELETE(req: Request) {
  if (!(await isAdminReq())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let id = "";
  try {
    id = String(((await req.json()) as { id?: string }).id ?? "");
  } catch {
    /* ignore */
  }
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });
  try {
    await prisma.user.delete({ where: { id } });
  } catch {
    /* already gone */
  }
  return NextResponse.json({ ok: true });
}
