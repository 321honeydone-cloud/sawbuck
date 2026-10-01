"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { Icon, initials, moneyWhole, usePresence, useOutside } from "./ui";

export interface JobCard {
  id: string;
  name: string;
  client: string;
  address: string;
  status: string;
  lines: number;
  smooth: number;
  max: number;
  hasCap: boolean;
  when: string;
  updatedAt: string;
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  won: "Won",
  complete: "Complete",
  invoiced: "Invoiced",
  archived: "Archived",
};
const FILTERS = ["all", "draft", "sent", "won", "invoiced", "archived"] as const;
type Filter = (typeof FILTERS)[number];

const step = (j: JobCard) => {
  if (j.status === "archived") return 0;
  if (j.status === "complete" || j.status === "invoiced") return 5;
  if (j.status === "won") return 4;
  if (j.status === "sent") return 3;
  return j.lines > 0 ? 2 : 1;
};
const matches = (f: Filter, s: string) => f === "all" || s === f || (f === "invoiced" && s === "complete");

type Sugg = { t: "client"; v: string; sub: string; n: number } | { t: "addr"; v: string; sub: string } | { t: "job"; job: JobCard };

function hl(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export default function JobBoard({ jobs }: { jobs: JobCard[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(-1);
  const comboRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setAct(-1);
  }, []);
  useOutside(comboRef, open, close);
  const pres = usePresence(open, 150);

  const ql = q.trim().toLowerCase();
  const sum = (f: (j: JobCard) => boolean) => jobs.filter(f).reduce((a, j) => a + j.max, 0);
  const sent = jobs.filter((j) => j.status === "sent");
  const stats: { key: Filter; v: string; l: string; cls: string }[] = [
    { key: "draft", v: String(jobs.filter((j) => j.status === "draft").length), l: "Drafts in progress", cls: "hot" },
    { key: "sent", v: moneyWhole(sum((j) => j.status === "sent")), l: `${sent.length} quote${sent.length === 1 ? "" : "s"} out`, cls: "money" },
    { key: "won", v: moneyWhole(sum((j) => j.status === "won")), l: "Won", cls: "money" },
    { key: "invoiced", v: moneyWhole(sum((j) => j.status === "invoiced" || j.status === "complete")), l: "Invoiced or complete", cls: "money" },
  ];

  const list = jobs.filter(
    (j) => matches(filter, j.status) && (!ql || `${j.name} ${j.client} ${j.address}`.toLowerCase().includes(ql)),
  );

  const sugg: Sugg[] = useMemo(() => {
    const out: Sugg[] = [];
    const clients = new Map<string, { n: number; sub: string }>();
    for (const j of jobs) {
      if (!j.client) continue;
      const c = clients.get(j.client);
      if (c) c.n++;
      else clients.set(j.client, { n: 1, sub: j.address || j.name });
    }
    [...clients.entries()]
      .filter(([c]) => !ql || c.toLowerCase().includes(ql))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([c, x]) => out.push({ t: "client", v: c, sub: x.sub, n: x.n }));
    if (ql) {
      const seen = new Set<string>();
      for (const j of jobs)
        if (j.address && j.address.toLowerCase().includes(ql) && !seen.has(j.address)) {
          seen.add(j.address);
          out.push({ t: "addr", v: j.address, sub: j.client || j.name });
        }
      for (const j of jobs) if (j.name.toLowerCase().includes(ql)) out.push({ t: "job", job: j });
    } else {
      for (const j of jobs.slice(0, 5)) out.push({ t: "job", job: j });
    }
    return out;
  }, [jobs, ql]);

  const pick = (s: Sugg | undefined) => {
    if (!s) return;
    close();
    if (s.t === "job") router.push(`/v2/job/${s.job.id}`);
    else setQ(s.v);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setAct((a) => (sugg.length ? (a + 1) % sugg.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAct((a) => (sugg.length ? (a - 1 + sugg.length) % sugg.length : -1));
    } else if (e.key === "Enter") {
      if (open && act >= 0) {
        e.preventDefault();
        pick(sugg[act]);
      } else close();
    }
  };

  let lastHead = "";
  const head = (t: Sugg["t"]) => {
    const h = t === "client" ? "Clients" : t === "addr" ? "Addresses" : ql ? "Jobs" : "Recent jobs";
    if (h === lastHead) return null;
    lastHead = h;
    return <div className="sh">{h}</div>;
  };

  return (
    <section className="home">
      <div className="label">HoneyDone Property Maintenance</div>
      <h1>Jobs</h1>
      <div className="stats">
        {stats.map((s) => (
          <button
            key={s.key}
            className={`stat ${s.cls}${filter === s.key ? " on" : ""}`}
            onClick={() => setFilter((f) => (f === s.key ? "all" : s.key))}
          >
            <b className="num">{s.v}</b>
            <small>{s.l}</small>
          </button>
        ))}
      </div>

      <div className="homesub">
        <div className={`search${open ? " is-open" : ""}`} ref={comboRef}>
          {Icon.search}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setAct(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
            placeholder="Search or pick a client"
            role="combobox"
            aria-expanded={open}
            aria-controls="v2-sugg"
            aria-autocomplete="list"
            autoComplete="off"
          />
          {q && (
            <button
              className="iconbtn"
              aria-label="Clear search"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQ("");
                setOpen(true);
                inputRef.current?.focus();
              }}
            >
              {Icon.x}
            </button>
          )}
          <button
            className="iconbtn"
            aria-label="Show clients"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (open) close();
              else {
                setOpen(true);
                inputRef.current?.focus();
              }
            }}
          >
            {Icon.chev}
          </button>
          {pres.render && (
            <div id="v2-sugg" className={`menu sugg ${pres.closing ? "pop-out" : "pop-in"}`} role="listbox" onMouseDown={(e) => e.preventDefault()}>
              {sugg.length === 0 && <div className="none">No client, address or job matches &ldquo;{q}&rdquo;.</div>}
              {sugg.map((s, i) => (
                <div key={i}>
                  {head(s.t)}
                  <button className={`si${i === act ? " act" : ""}`} role="option" aria-selected={i === act} onClick={() => pick(s)}>
                    {s.t === "client" ? (
                      <>
                        <span className="ic">{initials(s.v)}</span>
                        <span className="tx">
                          <b>{hl(s.v, ql)}</b>
                          <small>{s.sub}</small>
                        </span>
                        <span className="cnt">
                          {s.n} job{s.n === 1 ? "" : "s"}
                        </span>
                      </>
                    ) : s.t === "addr" ? (
                      <>
                        <span className="ic sq">{Icon.pin}</span>
                        <span className="tx">
                          <b>{hl(s.v, ql)}</b>
                          <small>{s.sub}</small>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="ic sq">{Icon.doc}</span>
                        <span className="tx">
                          <b>{hl(s.job.name, ql)}</b>
                          <small>
                            {s.job.client || "No client yet"} · {STATUS_LABEL[s.job.status] ?? s.job.status}
                          </small>
                        </span>
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="chips">
          {FILTERS.map((f) => (
            <button key={f} className={`chip${filter === f ? " on" : ""}`} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : STATUS_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="cards" key={`${filter}|${ql}`}>
        {list.length === 0 && (
          <div className="empty">
            {jobs.length === 0 ? "No jobs yet. Hit the + to start one." : "No jobs match. Clear the search or pick another stage."}
          </div>
        )}
        {list.map((j, i) => {
          const n = step(j);
          return (
            <Link key={j.id} href={`/v2/job/${j.id}`} className="jcard" style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}>
              <div className="top">
                <span className={`stage ${j.status}`}>{STATUS_LABEL[j.status] ?? j.status}</span>
                <span className="when">{j.when}</span>
              </div>
              <h3>{j.name || "Untitled job"}</h3>
              <div>
                <div>{j.client || <span className="muted">No client yet</span>}</div>
                {j.address && <div className="addr">{j.address}</div>}
              </div>
              <div className={`prog${n >= 4 ? " done" : ""}`} title={`Step ${n} of 5`}>
                {[1, 2, 3, 4, 5].map((k) => (
                  <i key={k} className={k <= n ? "on" : ""} />
                ))}
              </div>
              <div className="foot">
                {j.lines > 0 ? (
                  <span className="price num">
                    {moneyWhole(j.smooth)}
                    {j.hasCap && <small>up to {moneyWhole(j.max)}</small>}
                  </span>
                ) : (
                  <span className="price none">No quote yet</span>
                )}
                <span className="open">Open {Icon.right && <span style={{ width: 14, height: 14, display: "inline-flex" }}>{Icon.right}</span>}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
