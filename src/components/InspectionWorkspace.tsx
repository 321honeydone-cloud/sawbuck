"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Inspection, InspectionIssue, IssueSeverity, MediaItem } from "@/lib/types";
import { SEVERITIES, TRADES } from "@/lib/scout";

const MAX_PHOTOS = 12;

const SEV: Record<IssueSeverity, { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "border-red-500/40 bg-red-500/15 text-red-300" },
  major: { label: "Major", cls: "border-flag/40 bg-flag/15 text-flag" },
  moderate: { label: "Moderate", cls: "border-blue-500/40 bg-blue-500/15 text-blue-300" },
  minor: { label: "Minor", cls: "border-zinc-500/40 bg-zinc-500/15 text-zinc-300" },
};
const LICENSED = new Set(["Electrical", "Plumbing", "HVAC", "Foundation", "Roofing"]);
const needsPro = (i: InspectionIssue) => i.severity === "critical" || LICENSED.has(i.trade);

let iseq = 0;
const newIssueId = () => `iss_${Date.now().toString(36)}${(iseq++).toString(36)}`;

function Check({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={`grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border text-[11px] font-bold leading-none transition ${
        on ? "border-brand bg-brand text-black" : "border-border bg-card-2 text-transparent"
      }`}
    >
      ✓
    </button>
  );
}

function downscale(file: File, maxDim = 1280, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d")?.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function dataUrlToBlob(d: string): Blob {
  const [head, b64] = d.split(",");
  const mime = head.match(/:(.*?);/)?.[1] || "image/jpeg";
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime });
}

type Pending = { type: "image" | "video"; url: string; b64?: string };

export default function InspectionWorkspace({ initial }: { initial: Inspection }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [location, setLocation] = useState(initial.location ?? "");
  const [issues, setIssues] = useState<InspectionIssue[]>(initial.issues ?? []);

  const [pending, setPending] = useState<Pending[]>([]);
  const [note, setNote] = useState("");
  const [listening, setListening] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [building, setBuilding] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const recRef = useRef<unknown>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);

  const photoCount = pending.filter((p) => p.type === "image").length;

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const t = setTimeout(() => {
      void fetch("/api/inspection", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: initial.id, name, location, status: initial.status, issues }),
      });
    }, 600);
    return () => clearTimeout(t);
  }, [name, location, issues, initial.id, initial.status]);

  const speechOK =
    typeof window !== "undefined" &&
    Boolean(
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    );

  const toggleListen = () => {
    const W = window as unknown as Record<string, new () => unknown>;
    const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      (recRef.current as { stop?: () => void } | null)?.stop?.();
      return;
    }
    const rec = new SR() as {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let txt = "";
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      setNote(txt);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const uploadFile = async (file: Blob, filename: string): Promise<string> => {
    const fd = new FormData();
    fd.append("file", file, filename);
    fd.append("inspectionId", initial.id);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    if (!r.ok) throw new Error("upload failed");
    return ((await r.json()) as { url: string }).url;
  };

  // Batch upload: take a multi-select gallery pick, cap to remaining slots (MAX_PHOTOS), upload in parallel.
  const addPhotos = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_PHOTOS - photoCount;
    if (remaining <= 0) return;
    const list = Array.from(files).slice(0, remaining);
    setUploading(true);
    setUploadCount(list.length);
    try {
      const results = await Promise.all(
        list.map(async (file): Promise<Pending | null> => {
          try {
            const dataUrl = await downscale(file);
            const url = await uploadFile(dataUrlToBlob(dataUrl), "photo.jpg");
            return { type: "image", url, b64: dataUrl.split(",")[1] };
          } catch {
            return null;
          } finally {
            setUploadCount((n) => Math.max(0, n - 1));
          }
        })
      );
      const ok = results.filter((r): r is Pending => r !== null);
      if (ok.length) setPending((p) => [...p, ...ok]);
    } finally {
      setUploading(false);
      setUploadCount(0);
      if (photoRef.current) photoRef.current.value = "";
    }
  };

  const addVideo = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadFile(file, file.name || "clip.mp4");
      setPending((p) => [...p, { type: "video", url }]);
    } catch {
      /* ignore */
    } finally {
      setUploading(false);
      if (videoRef.current) videoRef.current.value = "";
    }
  };

  const analyzeAndAdd = async () => {
    if (!note.trim() && pending.length === 0) return;
    setAnalyzing(true);
    try {
      const images = pending.filter((p) => p.type === "image" && p.b64).map((p) => p.b64 as string);
      const videos = pending.filter((p) => p.type === "video").map((p) => p.url);
      const res = await fetch("/api/scout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: note, images, videos }),
      });
      const data = (await res.json()) as { issue: Omit<InspectionIssue, "id" | "position" | "media" | "include"> };
      const issue: InspectionIssue = {
        ...data.issue,
        id: newIssueId(),
        position: issues.length + 1,
        media: pending.map(({ type, url }) => ({ type, url })),
        include: true,
      };
      setIssues((prev) => [...prev, issue]);
      setPending([]);
      setNote("");
    } finally {
      setAnalyzing(false);
    }
  };

  const update = (id: string, patch: Partial<InspectionIssue>) =>
    setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const remove = (id: string) => setIssues((prev) => prev.filter((i) => i.id !== id));
  const move = (id: string, dir: -1 | 1) =>
    setIssues((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next.map((it, k) => ({ ...it, position: k + 1 }));
    });

  const createEstimate = async () => {
    setBuilding(true);
    try {
      const res = await fetch("/api/inspection/convert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: initial.id }),
      });
      if (res.ok) {
        const { id } = (await res.json()) as { id: string };
        router.push(`/estimate/${id}`);
        return;
      }
    } finally {
      setBuilding(false);
    }
  };

  const counts = SEVERITIES.map((s) => ({ s, n: issues.filter((i) => i.severity === s).length }));
  const proCount = issues.filter(needsPro).length;
  const includedCount = issues.filter((i) => i.include !== false).length;

  return (
    <main className="h-full overflow-y-auto text-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-2">
        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Property / inspection name"
            className="w-full truncate rounded bg-transparent px-1.5 py-0.5 font-display text-sm font-semibold uppercase tracking-[0.06em] text-ink outline-none hover:bg-card-2 focus:bg-card-2 focus:ring-1 focus:ring-brand/50"
          />
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Address"
            className="mt-0.5 w-full truncate rounded bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-muted outline-none hover:bg-card-2 focus:bg-card-2 focus:text-ink focus:ring-1 focus:ring-brand/50"
          />
        </div>
        <button
          onClick={createEstimate}
          disabled={building || includedCount === 0}
          className="rounded-md bg-brand px-3 py-2 font-display text-xs font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim disabled:opacity-40"
        >
          {building ? "…" : `Create Estimate (${includedCount})`}
        </button>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const files = Array.from(e.dataTransfer.files);
            const imgs = files.filter((f) => f.type.startsWith("image/"));
            const vids = files.filter((f) => f.type.startsWith("video/"));
            if (imgs.length) void addPhotos(imgs);
            for (const v of vids) void addVideo(v);
          }}
          className={`rounded-xl border bg-card p-3 transition ${
            dragOver ? "border-brand bg-brand/5 ring-1 ring-brand/40" : "border-border"
          }`}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-gold">Walk & talk</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
              {dragOver ? "Drop to add" : "Drag photos or video here"}
            </span>
          </div>

          <input ref={photoRef} type="file" accept="image/*" multiple hidden onChange={(e) => void addPhotos(e.target.files)} />
          <input ref={videoRef} type="file" accept="video/*" capture="environment" hidden onChange={(e) => void addVideo(e.target.files?.[0])} />

          {pending.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pending.map((m, i) => (
                <div key={i} className="relative">
                  {m.type === "video" ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video src={m.url} className="h-20 w-28 rounded-lg border border-border object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.b64 ? `data:image/jpeg;base64,${m.b64}` : m.url} alt="" className="h-20 w-20 rounded-lg border border-border object-cover" />
                  )}
                  <button
                    onClick={() => setPending((p) => p.filter((_, k) => k !== i))}
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-card-2 text-xs text-muted hover:text-flag"
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mb-2 flex items-center gap-2">
            <button
              onClick={() => photoRef.current?.click()}
              disabled={uploading || photoCount >= MAX_PHOTOS}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition hover:border-brand/50 hover:text-ink disabled:opacity-40"
            >
              {uploading ? `Uploading ${uploadCount}…` : `📷 Add photos (${photoCount}/${MAX_PHOTOS})`}
            </button>
            <button
              onClick={() => videoRef.current?.click()}
              disabled={uploading}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition hover:border-brand/50 hover:text-ink disabled:opacity-40"
            >
              🎥 Video
            </button>
          </div>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={listening ? "Listening…" : 'Talk or type, e.g. "cracked grout in the master shower, moderate"'}
            className="w-full resize-none rounded-lg border border-border bg-card-2 px-2.5 py-2 text-sm text-ink outline-none focus:border-brand/60"
          />
          <div className="mt-2 flex items-center gap-2">
            {speechOK && (
              <button
                onClick={toggleListen}
                className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                  listening ? "border-flag/50 bg-flag/15 text-flag" : "border-border text-muted hover:text-ink"
                }`}
              >
                {listening ? "■ Stop" : "● Talk"}
              </button>
            )}
            <button
              onClick={analyzeAndAdd}
              disabled={analyzing || (!note.trim() && pending.length === 0)}
              className="ml-auto rounded-md bg-brand px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim disabled:opacity-40"
            >
              {analyzing ? "Reading…" : "Add issue"}
            </button>
          </div>
        </div>

        {includedCount > 0 && (
          <button
            onClick={createEstimate}
            disabled={building}
            className="w-full rounded-xl bg-brand px-4 py-3 font-display text-sm font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim disabled:opacity-40"
          >
            {building ? "Building the estimate…" : `Create Estimate (${includedCount})`}
          </button>
        )}

        {issues.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{issues.length} issues</span>
            {counts.filter((c) => c.n > 0).map((c) => (
              <span key={c.s} className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${SEV[c.s].cls}`}>
                {c.n} {SEV[c.s].label}
              </span>
            ))}
            <span className="rounded border border-brand/40 bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-brand">
              {includedCount} of {issues.length} on quote
            </span>
            {proCount > 0 && (
              <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.1em] text-flag">
                {proCount} may need a licensed pro
              </span>
            )}
          </div>
        )}

        <div className="space-y-3">
          {issues.length === 0 && (
            <p className="py-10 text-center text-sm text-muted">No issues yet. Snap or film a defect and describe it.</p>
          )}
          {issues.map((issue, idx) => (
            <IssueCard key={issue.id} issue={issue} index={idx} total={issues.length} onUpdate={update} onRemove={remove} onMove={move} />
          ))}
        </div>
      </div>
    </main>
  );
}

function MediaStrip({ media }: { media: MediaItem[] }) {
  if (!media || media.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {media.map((m, i) =>
        m.type === "video" ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video key={i} src={m.url} controls className="h-24 w-32 rounded-lg border border-border object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={m.url} alt="" className="h-24 w-24 rounded-lg border border-border object-cover" />
        )
      )}
    </div>
  );
}

function IssueCard({
  issue,
  index,
  total,
  onUpdate,
  onRemove,
  onMove,
}: {
  issue: InspectionIssue;
  index: number;
  total: number;
  onUpdate: (id: string, patch: Partial<InspectionIssue>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  const included = issue.include !== false;
  return (
    <div className={`overflow-hidden rounded-xl border bg-card p-3 ${included ? "border-border" : "border-border/60"}`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Check on={included} onChange={() => onUpdate(issue.id, { include: !included })} label="Include on quote" />
        <span className="font-mono text-[10px] text-muted">{index + 1}.</span>
        <select
          value={issue.trade}
          onChange={(e) => onUpdate(issue.id, { trade: e.target.value })}
          className="rounded border border-border bg-card-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted outline-none hover:border-brand/50"
        >
          {(TRADES as readonly string[]).includes(issue.trade) ? null : <option value={issue.trade}>{issue.trade}</option>}
          {TRADES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={issue.severity}
          onChange={(e) => onUpdate(issue.id, { severity: e.target.value as IssueSeverity, inspectorSet: true })}
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${SEV[issue.severity].cls}`}
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEV[s].label}
            </option>
          ))}
        </select>
        {needsPro(issue) && <span className="font-mono text-[9px] uppercase text-flag">licensed pro</span>}
        {!included && (
          <span className="rounded border border-flag/40 bg-flag/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-flag">
            Excluded
          </span>
        )}
        <div className="ml-auto flex items-center gap-1 text-muted">
          <button onClick={() => onMove(issue.id, -1)} disabled={index === 0} className="px-1 hover:text-ink disabled:opacity-30" aria-label="Move up">↑</button>
          <button onClick={() => onMove(issue.id, 1)} disabled={index === total - 1} className="px-1 hover:text-ink disabled:opacity-30" aria-label="Move down">↓</button>
          <button onClick={() => onRemove(issue.id)} className="px-1 hover:text-flag" aria-label="Remove">✕</button>
        </div>
      </div>
      <div className={included ? "" : "opacity-50"}>
        <MediaStrip media={issue.media ?? []} />
        <textarea
          value={issue.defect}
          onChange={(e) => onUpdate(issue.id, { defect: e.target.value })}
          rows={2}
          className="w-full resize-none rounded bg-transparent px-1 py-0.5 text-sm text-ink outline-none hover:bg-card-2 focus:bg-card-2 focus:ring-1 focus:ring-brand/50"
        />
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          <label className="block">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">Risk</span>
            <textarea
              value={issue.risk}
              onChange={(e) => onUpdate(issue.id, { risk: e.target.value })}
              rows={2}
              className="w-full resize-none rounded bg-card-2/60 px-1.5 py-1 text-xs text-ink outline-none focus:ring-1 focus:ring-brand/50"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">Recommendation</span>
            <textarea
              value={issue.recommendation}
              onChange={(e) => onUpdate(issue.id, { recommendation: e.target.value })}
              rows={2}
              className="w-full resize-none rounded bg-card-2/60 px-1.5 py-1 text-xs text-ink outline-none focus:ring-1 focus:ring-brand/50"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
