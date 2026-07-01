import { prisma } from "@/lib/db";
import { estimateFromRow } from "@/lib/serialize";
import { getSession } from "@/lib/session";
import QuoteList, { type QuoteRow } from "@/components/QuoteList";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const session = await getSession();
  const isAdmin = session?.role === "admin";
  const where = isAdmin ? {} : { userId: session?.uid };
  const rows = await prisma.estimate.findMany({ where, orderBy: { updatedAt: "desc" } });

  const nameById = new Map<string, string>();
  if (isAdmin) {
    const users = await prisma.user.findMany({ select: { id: true, name: true } });
    for (const u of users) nameById.set(u.id, u.name);
  }
  const creatorOf = (userId: string | null): string => {
    if (!userId) return "Unassigned";
    if (userId === "owner") return "Owner";
    return nameById.get(userId) ?? "Unknown";
  };

  const quotes: QuoteRow[] = rows.map((r) => {
    const e = estimateFromRow(r);
    return {
      id: e.id,
      name: e.name,
      location: e.location,
      status: e.status,
      total: e.totals.estimateTotal,
      items: e.groups.reduce((n, g) => n + g.items.length, 0),
      date: new Date(r.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      creator: isAdmin ? creatorOf(r.userId) : undefined,
      clientName: e.clientName ?? null,
    };
  });

  const totalValue = quotes.reduce((n, q) => n + q.total, 0);
  const openValue = quotes.filter((q) => q.status === "draft" || q.status === "sent").reduce((n, q) => n + q.total, 0);

  return (
    <main className="h-full overflow-y-auto text-ink">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-card px-5 py-2.5">
        <h1 className="font-display text-base font-bold uppercase tracking-[0.08em]">Quote History</h1>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">
          {quotes.length} saved{isAdmin ? " · all users" : ""}
        </span>
        {quotes.length > 0 && (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {money(totalValue)} total · {money(openValue)} still open
          </span>
        )}
      </header>
      <div className="mx-auto max-w-3xl px-5 py-6">
        <QuoteList quotes={quotes} showCreator={isAdmin} />
      </div>
    </main>
  );
}
