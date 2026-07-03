import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid h-dvh place-items-center overflow-y-auto px-4 text-ink">
      <div className="text-center">
        <div className="font-display text-2xl font-bold uppercase tracking-[0.1em]">Not found</div>
        <p className="mt-2 text-sm text-muted">That page or quote is not here.</p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-md bg-brand px-4 py-2 font-display text-sm font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim"
        >
          Back to estimator
        </Link>
      </div>
    </main>
  );
}
