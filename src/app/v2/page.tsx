import { prisma } from "@/lib/db";
import { estimateFromRow } from "@/lib/serialize";
import { getSession } from "@/lib/session";
import { splitBuilds } from "@/lib/builds";
import JobBoard, { type JobCard } from "@/v2/JobBoard";

export const dynamic = "force-dynamic";

const when = (d: Date) => {
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

// Jobs home: every quote as a card. Admin sees everyone's, crew see their own.
export default async function V2Home() {
  const session = await getSession();
  const where = session && session.role !== "admin" ? { userId: session.uid } : {};
  const rows = await prisma.estimate.findMany({ where, orderBy: { updatedAt: "desc" } });

  const jobs: JobCard[] = rows.map((r) => {
    const e = estimateFromRow(r);
    const split = splitBuilds(e);
    const lines = e.groups.reduce((n, g) => n + g.items.length, 0);
    const updated = new Date(r.updatedAt);
    return {
      id: e.id,
      name: e.name,
      client: e.clientName?.trim() || "",
      address: e.clientAddress?.trim() || (e.location && e.location !== "Florida" ? e.location : ""),
      status: e.status,
      lines,
      smooth: split.hasCap ? split.smoothCash : split.maxCash,
      max: split.maxCash,
      hasCap: split.hasCap,
      when: when(updated),
      updatedAt: updated.toISOString(),
    };
  });

  return <JobBoard jobs={jobs} />;
}
