import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { estimateFromRow } from "@/lib/serialize";
import { getSession } from "@/lib/session";
import type { ChatMessage } from "@/lib/types";
import JobScreen, { type JobLink } from "@/v2/JobScreen";

export const dynamic = "force-dynamic";

export default async function V2Job({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const listWhere = session && session.role !== "admin" ? { userId: session.uid } : {};

  const [row, all] = await Promise.all([
    prisma.estimate.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } }),
    prisma.estimate.findMany({ where: listWhere, orderBy: { updatedAt: "desc" }, take: 60 }),
  ]);
  if (!row) notFound();
  // A crew member can only open their own quotes.
  if (session && session.role !== "admin" && row.userId !== session.uid) notFound();

  const estimate = estimateFromRow(row);
  const messages: ChatMessage[] = row.messages.map((m) => {
    const base: ChatMessage = { id: m.id, role: m.role as ChatMessage["role"], content: m.content };
    if (m.meta) {
      try {
        Object.assign(base, JSON.parse(m.meta) as Partial<ChatMessage>);
      } catch {
        /* unreadable meta */
      }
    }
    return base;
  });
  const jobs: JobLink[] = all.map((r) => {
    const e = estimateFromRow(r);
    return { id: e.id, name: e.name, client: e.clientName ?? "", status: e.status };
  });

  return <JobScreen initialEstimate={estimate} initialMessages={messages} jobs={jobs} />;
}
