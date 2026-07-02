import { redirect } from "next/navigation";
import UserManager from "@/components/UserManager";
import AiBrainToggle from "@/components/AiBrainToggle";
import CrewQuotes, { type UserQuoteGroup, type CrewQuote } from "@/components/CrewQuotes";
import { prisma } from "@/lib/db";
import { estimateFromRow } from "@/lib/serialize";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/");

  const users = await prisma.user.findMany({
    select: { id: true, name: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  const rows = await prisma.estimate.findMany({
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } } },
  });

  // Group every quote under the user who built it.
  const byUser = new Map<string, CrewQuote[]>();
  for (const r of rows) {
    const e = estimateFromRow(r);
    const userMsgs = (r.messages ?? []).filter((m: { role: string }) => m.role === "user");
    const pricePushback = userMsgs.some((m: { content: string }) =>
      /too expensive|too much|cheaper|lower (the )?price|come down|over budget|pricey|too high|that is a lot/i.test(m.content)
    );
    const row: CrewQuote = {
      id: e.id,
      name: e.name,
      location: e.location,
      status: e.status,
      total: e.totals.estimateTotal,
      items: e.groups.reduce((n, g) => n + g.items.length, 0),
      date: new Date(r.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      transcript: (r.messages ?? []).map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
      summary: {
        mainAsk: (userMsgs[0]?.content ?? "").slice(0, 140),
        turns: userMsgs.length,
        pricePushback,
      },
    };
    const key = r.userId ?? "unassigned";
    const arr = byUser.get(key) ?? [];
    arr.push(row);
    byUser.set(key, arr);
  }

  const groups: UserQuoteGroup[] = users.map((u) => ({
    key: u.id,
    name: u.name,
    role: u.role,
    quotes: byUser.get(u.id) ?? [],
  }));
  const ownerQuotes = byUser.get("owner") ?? [];
  if (ownerQuotes.length) groups.push({ key: "owner", name: "Owner", role: "owner", quotes: ownerQuotes });
  const unassigned = byUser.get("unassigned") ?? [];
  if (unassigned.length) groups.push({ key: "unassigned", name: "Unassigned", role: "", quotes: unassigned });

  let feedback: { id: string; userName: string | null; role: string | null; message: string; page: string | null; date: string }[] = [];
  try {
    const fb = await prisma.feedback.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    feedback = fb.map((f: { id: string; userName: string | null; role: string | null; message: string; page: string | null; createdAt: Date }) => ({
      id: f.id,
      userName: f.userName,
      role: f.role,
      message: f.message,
      page: f.page,
      date: new Date(f.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    }));
  } catch {
    /* feedback table not migrated yet */
  }

  return (
    <main className="h-full overflow-y-auto text-ink">
      <header className="flex items-center gap-3 border-b border-border bg-card px-5 py-2.5 backdrop-blur-sm">
        <h1 className="font-display text-base font-bold uppercase tracking-[0.08em]">Admin</h1>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">Users &amp; quotes</span>
      </header>

      <div className="mx-auto max-w-2xl space-y-7 px-5 py-6">
        <section className="space-y-4">
          <p className="text-sm text-muted">
            Each user logs in with their own PIN and sees only their own quotes. You, the owner, see everyone&apos;s.
            Add or remove crew here.
          </p>
          <UserManager />
        </section>

        <section className="space-y-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">AI brain</div>
          <p className="text-xs text-muted">
            Pick which brain runs the crew. Claude works everywhere. Local (Ollama) only runs when you open the app on a
            machine that can see your Ollama box.
          </p>
          <AiBrainToggle />
        </section>

        <section className="space-y-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">Crew quotes</div>
          <p className="text-xs text-muted">
            Tap a name to drop down the quotes they built. Open any one to review it or change it.
          </p>
          <CrewQuotes groups={groups} />
        </section>

        <section className="space-y-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">Feedback</div>
          {feedback.length === 0 ? (
            <p className="text-xs text-muted">No feedback yet. The Feedback button sits on every screen for your crew.</p>
          ) : (
            <div className="space-y-2">
              {feedback.map((f) => (
                <div key={f.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                    <span>
                      {f.userName || "Someone"}
                      {f.role ? ` \u00b7 ${f.role}` : ""}
                    </span>
                    <span>
                      {f.date}
                      {f.page ? ` \u00b7 ${f.page}` : ""}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{f.message}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
