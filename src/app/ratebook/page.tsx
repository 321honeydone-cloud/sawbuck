import { redirect } from "next/navigation";
import RateBookManager from "@/components/RateBookManager";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Owner/admin only, same gate as Admin. Crew on user PINs never see pricing.
export default async function RateBookPage() {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/");

  return (
    <main className="flex h-full flex-col text-ink">
      <header className="flex items-center gap-3 border-b border-border bg-card px-5 py-2.5 backdrop-blur-sm">
        <h1 className="font-display text-base font-bold uppercase tracking-[0.08em]">Rate Book</h1>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">Price &amp; edit your tasks</span>
      </header>
      <RateBookManager />
    </main>
  );
}
