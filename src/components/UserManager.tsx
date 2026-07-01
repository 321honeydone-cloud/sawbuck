"use client";

import { useEffect, useState } from "react";

interface AppUser {
  id: string;
  name: string;
  role: string;
  pin?: string | null;
  createdAt?: string;
}

const ERRORS: Record<string, string> = {
  pin_in_use: "That PIN is already taken. Pick another.",
  pin_format: "PIN must be 4 to 8 digits.",
  name_required: "Enter a name.",
};

export default function UserManager() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState("user");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsers((await res.json()).users ?? []);
  };
  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, pin, role }),
      });
      if (res.ok) {
        setName("");
        setPin("");
        setRole("user");
        await load();
      } else {
        const d = (await res.json()) as { error?: string };
        setError(ERRORS[d.error ?? ""] ?? "Could not add user.");
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-gold">Add user</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dave"
              className="w-40 rounded-md border border-border bg-card-2 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand/60"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">PIN (4-8 digits)</span>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              placeholder="••••"
              className="w-28 rounded-md border border-border bg-card-2 px-2.5 py-1.5 text-sm tracking-[0.3em] text-ink outline-none focus:border-brand/60"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded-md border border-border bg-card-2 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand/60"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button
            onClick={add}
            disabled={busy || !name || !pin}
            className="rounded-md bg-brand px-3 py-2 font-display text-xs font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim disabled:opacity-40"
          >
            {busy ? "…" : "Add"}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-flag">{error}</p>}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-gold">
          Users ({users.length})
        </div>
        <p className="mb-2 text-xs text-muted">You (Owner) sign in with the PIN in your .env (APP_PINS). Crew PINs show below.</p>
        {users.length === 0 ? (
          <p className="text-sm text-muted">No users yet. You are signed in as the owner. Add your crew above.</p>
        ) : (
          <div className="divide-y divide-border">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-ink">{u.name}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${
                      u.role === "admin" ? "bg-brand/15 text-brand" : "bg-card-2 text-muted"
                    }`}
                  >
                    {u.role}
                  </span>
                  {u.pin ? (
                    <span className="rounded bg-card-2 px-1.5 py-0.5 font-mono text-[11px] tracking-[0.18em] text-gold">
                      PIN {u.pin}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-muted">PIN hidden, re-add to show</span>
                  )}
                </div>
                <button
                  onClick={() => remove(u.id)}
                  className="rounded border border-border px-2 py-1 text-xs text-muted transition hover:border-flag/50 hover:text-flag"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
