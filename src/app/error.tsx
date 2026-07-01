"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 text-ink">
      <div className="text-center">
        <div className="font-display text-xl font-bold uppercase tracking-[0.08em]">Something went wrong</div>
        <p className="mt-2 text-sm text-muted">Give it another try.</p>
        <button
          onClick={reset}
          className="mt-5 rounded-md bg-brand px-4 py-2 font-display text-sm font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
