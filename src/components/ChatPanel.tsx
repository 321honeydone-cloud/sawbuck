"use client";

import { useEffect, useRef, useState } from "react";
import { useEstimateStore } from "@/store/useEstimateStore";
import { money } from "@/lib/format";
import { ACCEPT, MAX_FILES, fileToAttachment } from "@/lib/attachments";
import type { Attachment, ChatMessage } from "@/lib/types";
import { JOB_TEMPLATES } from "@/lib/honeydone";

// Minimal shape of the browser Speech Recognition API (Chrome and Edge).
type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
function getSpeechRecognition(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export default function ChatPanel() {
  const messages = useEstimateStore((s) => s.messages);
  const isStreaming = useEstimateStore((s) => s.isStreaming);
  const sendMessage = useEstimateStore((s) => s.sendMessage);
  const [draft, setDraft] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [listening, setListening] = useState(false);
  const [micSupported, setMicSupported] = useState(false);

  // Grow the prompt box with the text (up to a cap, then scroll), like the
  // chat box in Claude, instead of letting the line run off the edge.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);
  const recogRef = useRef<SpeechRec | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setMicSupported(!!getSpeechRecognition());
  }, []);

  const onFilesPicked = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setFileError(null);
    const room = MAX_FILES - files.length;
    const picked = Array.from(list).slice(0, room);
    if (list.length > room) setFileError(`Up to ${MAX_FILES} files; extra ignored.`);
    setProcessing(true);
    const added: Attachment[] = [];
    for (const f of picked) {
      try {
        added.push(await fileToAttachment(f));
      } catch (e) {
        setFileError((e as Error).message);
      }
    }
    setFiles((prev) => [...prev, ...added].slice(0, MAX_FILES));
    setProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (i: number) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

  const canSend = !isStreaming && !processing && (draft.trim().length > 0 || files.length > 0);

  const submit = () => {
    if (!canSend) return;
    const text = draft;
    const attachments = files;
    setDraft("");
    setFiles([]);
    setFileError(null);
    void sendMessage(text, attachments);
  };

  const toggleMic = () => {
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      said = said.trim();
      if (said) setDraft((d) => (d ? d + " " : "") + said);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recogRef.current = rec;
    setListening(true);
    rec.start();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-[0.08em] text-ink">Sawbuck AI</h2>
        <p className="text-xs text-muted">Describe the job. The estimate builds itself.</p>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-auto px-4 py-4">
        {messages.length === 0 && <IntakeBox onSend={(t) => void sendMessage(t)} />}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} onSuggestion={(t) => void sendMessage(t)} />
        ))}
      </div>

      <div className="border-t border-border p-3">
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-card-2 px-2 py-1 text-xs text-ink"
              >
                <span>{f.kind === "pdf" ? "📄" : "🖼️"}</span>
                <span className="max-w-[140px] truncate">{f.name}</span>
                <button
                  onClick={() => removeFile(i)}
                  className="text-muted hover:text-ink"
                  aria-label={`Remove ${f.name}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        {fileError && <p className="mb-2 text-xs text-flag">{fileError}</p>}

        <div className="flex items-end gap-2 rounded-xl border border-border bg-card-2 px-3 py-2 focus-within:border-brand/60">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => void onFilesPicked(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || files.length >= MAX_FILES}
            title={files.length >= MAX_FILES ? `Max ${MAX_FILES} files` : "Attach photos or PDFs"}
            className="shrink-0 rounded-lg border border-border px-2 py-1.5 text-sm text-muted transition hover:border-brand/50 hover:text-ink disabled:opacity-40"
            aria-label="Attach files"
          >
            📎
          </button>
          {micSupported && (
            <button
              onClick={toggleMic}
              disabled={isStreaming}
              title={listening ? "Stop voice input" : "Speak the job"}
              aria-label="Voice input"
              className={`shrink-0 rounded-lg border px-2 py-1.5 text-sm transition disabled:opacity-40 ${
                listening
                  ? "animate-pulse border-brand bg-brand/15 text-brand"
                  : "border-border text-muted hover:border-brand/50 hover:text-ink"
              }`}
            >
              🎤
            </button>
          )}
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={files.length ? "Add a note…" : "Describe the job"}
            className="max-h-32 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-1 text-sm leading-5 text-ink outline-none placeholder:text-muted"
          />
          <button
            onClick={submit}
            disabled={!canSend}
            className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-black transition disabled:opacity-40"
          >
            {isStreaming ? "…" : processing ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

const TIMEFRAMES = ["ASAP", "Tomorrow", "This week", "Flexible"];

/** The main box you speak to: describe the job, pick a timeframe, the Boss routes it. */
function IntakeBox({ onSend }: { onSend: (t: string) => void }) {
  const [desc, setDesc] = useState("");
  const [tf, setTf] = useState<string>("");

  const build = () => {
    const d = desc.trim();
    if (!d) return;
    const extra = tf && tf !== "Flexible" ? ` Need it ${tf.toLowerCase()}.` : "";
    onSend(d + extra);
    setDesc("");
    setTf("");
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card-2 p-4">
        <p className="font-display text-sm font-semibold uppercase tracking-[0.06em] text-ink">Tell me what you need</p>
        <p className="mt-1 text-xs text-muted">
          Describe the job and when you need it. I route it to the right trade crew and build the quote.
        </p>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              build();
            }
          }}
          rows={3}
          placeholder="For example: replace rotted fascia on the front, repaint the soffit, and regrout the guest shower"
          className="mt-3 w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-brand/60"
        />
        <div className="mt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-gold">Timeframe</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {TIMEFRAMES.map((t) => (
              <button
                key={t}
                onClick={() => setTf(tf === t ? "" : t)}
                className={
                  tf === t
                    ? "rounded-full border border-brand bg-brand/15 px-3 py-1 text-xs font-medium text-brand"
                    : "rounded-full border border-border px-3 py-1 text-xs text-ink transition hover:border-brand/60"
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={build}
          disabled={!desc.trim()}
          className="mt-4 w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-black transition disabled:opacity-40"
        >
          Build the quote
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card-2 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-gold">Common jobs</p>
        <div className="mt-3 flex flex-col gap-2">
          {JOB_TEMPLATES.map((t) => (
            <button
              key={t.key}
              onClick={() => onSend(t.prompt)}
              className="rounded-lg border border-border px-3 py-2 text-left text-sm text-ink transition hover:border-brand/60 hover:bg-card"
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Or just type the work in your own words below.</p>
      </div>
    </div>
  );
}

function MessageBubble({ message, onSuggestion }: { message: ChatMessage; onSuggestion: (t: string) => void }) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div className={isUser ? "max-w-[85%] min-w-0 break-words" : "w-full min-w-0 break-words"}>
        {!isUser && message.trace && message.trace.length > 0 && (
          <div className="mb-1.5 space-y-0.5 rounded-lg border border-border/60 bg-card-2/60 px-2.5 py-1.5 font-mono text-[0.68rem] leading-relaxed text-muted">
            {message.trace.map((t, i) => (
              <div key={i}>{t}</div>
            ))}
          </div>
        )}
        {!isUser && message.agents && message.agents.length > 0 && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted">Crew</span>
            {message.agents.map((a) => (
              <span
                key={a}
                className="rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-[0.68rem] font-medium text-brand"
              >
                {a}
              </span>
            ))}
          </div>
        )}
        <div
          className={
            isUser
              ? "rounded-2xl rounded-br-sm bg-brand px-3.5 py-2 text-sm text-black"
              : "text-sm leading-relaxed text-ink"
          }
        >
          <span className={message.streaming ? "caret whitespace-pre-wrap break-words" : "whitespace-pre-wrap break-words"}>
            {message.content || (isUser && message.attachments?.length ? "Sent attachments" : "")}
          </span>
        </div>

        {message.attachments && message.attachments.length > 0 && (
          <div className={`mt-1.5 flex flex-wrap gap-1.5 ${isUser ? "justify-end" : ""}`}>
            {message.attachments.map((a, i) => (
              <span
                key={`${a.name}-${i}`}
                className="flex items-center gap-1 rounded-md border border-border bg-card-2 px-1.5 py-0.5 text-xs text-muted"
              >
                <span>{a.kind === "pdf" ? "📄" : "🖼️"}</span>
                <span className="max-w-[120px] truncate">{a.name}</span>
              </span>
            ))}
          </div>
        )}

        {message.milestone && (
          <div className="mt-2 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-sm font-medium text-brand">
            {message.milestone}
          </div>
        )}

        {message.summary && (
          <div className="mt-2 rounded-xl border border-border bg-card-2 p-3">
            <div className="text-xs uppercase tracking-wide text-muted">Estimate summary</div>
            <div className="mt-1 font-semibold">{message.summary.name}</div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-muted">{message.summary.itemCount} line items</span>
              <span className="font-semibold text-brand">{money(message.summary.total)}</span>
            </div>
          </div>
        )}

        {message.suggestions && message.suggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.suggestions.map((s) => (
              <button
                key={s}
                onClick={() => onSuggestion(s)}
                className="rounded-full border border-border px-3 py-1 text-xs text-ink transition hover:border-brand/60 hover:bg-card-2"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
