import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { estimateFromRow } from "@/lib/serialize";
import type { ChatMessage } from "@/lib/types";
import Workspace, { type EstimateSummary } from "@/components/Workspace";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const listWhere = session && session.role !== "admin" ? { userId: session.uid } : {};

  const [row, all] = await Promise.all([
    prisma.estimate.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    }),
    prisma.estimate.findMany({
      where: listWhere,
      select: { id: true, name: true, status: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  if (!row) notFound();
  // Per-user: a non-admin can only open their own quotes.
  if (session && session.role !== "admin" && row.userId !== session.uid) notFound();

  const estimate = estimateFromRow(row);
  const messages: ChatMessage[] = row.messages.map((m: { id: string; role: string; content: string; meta: string | null }) => {
    const base: ChatMessage = { id: m.id, role: m.role as ChatMessage["role"], content: m.content };
    if (m.meta) {
      try {
        Object.assign(base, JSON.parse(m.meta) as Partial<ChatMessage>);
      } catch {
        /* ignore unreadable meta */
      }
    }
    return base;
  });
  const estimates: EstimateSummary[] = all.map((e) => ({ id: e.id, name: e.name, status: e.status }));

  return <Workspace initialEstimate={estimate} initialMessages={messages} estimates={estimates} />;
}
