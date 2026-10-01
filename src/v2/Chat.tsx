"use client";

import { useEffect, useRef, useState } from "react";
import { useEstimateStore } from "@/store/useEstimateStore";
import { ACCEPT, MAX_FILES, fileToAttachment } from "@/lib/attachments";
import { JOB_TEMPLATES } from "@/lib/honeydone";
import type { Attachment, ChatMessage } from "@/lib/types";
import { Icon, moneyWhole } from "./ui";

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
function speechCtor(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export default function Chat() {
  const messages = useEstimateStore((s) => s.messages);
  const streaming = useEstimateStore((s) => s.isStreaming);
  const send = useEstimateStore((s) => s.sendMessage);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [mic, setMic] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const firstCount = useRef(messages.length);

  useEffect(() => setMic(!!speechCtor()), []);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setFileErr(null);
    const room = MAX_FILES - files.length;
    const chosen = Array.from(list).slice(0, room);
    if (list.length > room) setFileErr(`Up to ${MAX_FILES} files. Extras were skipped.`);
    setBusy(true);
    const added: Attachment[] = [];
    for (const f of chosen) {
      try {
        added.push(await fileToAttachment(f));
      } catch (e) {
        setFileErr((e as Error).message);
      }
    }
    setFiles((p) => [...p, ...added].slice(0, MAX_FILES));
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const canSend = !streaming && !busy && (draft.trim().length > 0 || files.length > 0);
  const submit = () => {
    if (!canSend) return;
    const t = draft;
    const a = files;
    setDraft("");
    setFiles([]);
    setFileErr(null);
    stick.current = true;
    void send(t, a);
  };

  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const C = speechCtor();
    if (!C) return;
    const r = new C();
    r.lang = "en-US";
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      said = said.trim();
      if (said) setDraft((d) => (d ? `${d} ${said}` : said));
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r;
    setListening(true);
    r.start();
  };

  return (
    <section className="chat" aria-label="Chat">
      <div className="phead">
        <h4>Sawbuck</h4>
        <span className="muted" style={{ fontSize: 12.5 }}>
          Describe the job. The quote builds itself.
        </span>
      </div>
      <div
        className="msgs"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
        }}
      >
        {messages.map((m, i) => (
          <Message key={m.id} m={m} animate={i >= firstCount.current} onSend={(t) => void send(t)} />
        ))}
        {messages.every((m) => m.role !== "user") && <Intake onSend={(t) => void send(t)} />}
      </div>
      <div className="composer">
        {files.length > 0 && (
          <div className="files">
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`}>
                {f.name}
                <button className="iconbtn" style={{ width: 20, height: 20 }} aria-label={`Remove ${f.name}`} onClick={() => setFiles((p) => p.filter((_, k) => k !== i))}>
                  {Icon.x}
                </button>
              </span>
            ))}
          </div>
        )}
        {fileErr && <div style={{ color: "var(--bad)", fontSize: 12.5 }}>{fileErr}</div>}
        <div className="cbox">
          <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => void pick(e.target.files)} />
          <button className="iconbtn" aria-label="Attach photos or PDFs" title="Attach photos or PDFs" disabled={streaming || files.length >= MAX_FILES} onClick={() => fileRef.current?.click()}>
            {Icon.clip}
          </button>
          {mic && (
            <button className={`iconbtn${listening ? " live" : ""}`} aria-label="Talk instead of typing" title={listening ? "Stop listening" : "Talk"} disabled={streaming} onClick={toggleMic}>
              {Icon.mic}
            </button>
          )}
          <textarea
            ref={taRef}
            rows={1}
            value={draft}
            placeholder={files.length ? "Add a note" : "Describe the job"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button className="btn" style={{ padding: "6px 12px" }} disabled={!canSend} onClick={submit} aria-label="Send">
            {streaming || busy ? <span className="spin" style={{ borderColor: "var(--accent-ink)", borderTopColor: "transparent" }} /> : "Send"}
          </button>
        </div>
      </div>
    </section>
  );
}

const TIMEFRAMES = ["ASAP", "Tomorrow", "This week", "Flexible"];

function Intake({ onSend }: { onSend: (t: string) => void }) {
  const [desc, setDesc] = useState("");
  const [tf, setTf] = useState("");
  const go = () => {
    const d = desc.trim();
    if (!d) return;
    onSend(d + (tf && tf !== "Flexible" ? ` Need it ${tf.toLowerCase()}.` : ""));
    setDesc("");
    setTf("");
  };
  return (
    <div className="intake">
      <b>What do you need done?</b>
      <span className="muted" style={{ fontSize: 13 }}>
        Describe the job and when. Sawbuck routes it to the right trade and builds the quote at your pricing.
      </span>
      <textarea
        className="field"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Replace rotted fascia on the front, repaint the soffit, regrout the guest shower"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            go();
          }
        }}
      />
      <div className="suggest" style={{ marginTop: 0 }}>
        {TIMEFRAMES.map((t) => (
          <button key={t} onClick={() => setTf(tf === t ? "" : t)} style={tf === t ? { borderColor: "var(--accent)", color: "var(--accent-text)", background: "var(--accent-soft)" } : undefined}>
            {t}
          </button>
        ))}
      </div>
      <button className="btn" onClick={go} disabled={!desc.trim()}>
        Build the quote
      </button>
      <div className="label" style={{ marginTop: 4 }}>
        Common jobs
      </div>
      <div className="tpl">
        {JOB_TEMPLATES.map((t) => (
          <button key={t.key} onClick={() => onSend(t.prompt)}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Working() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const label = s < 8 ? "Reading the job" : s < 30 ? "Pricing it out" : s < 75 ? "Still working on the bigger job" : "Big one. The crew is still on it";
  return (
    <span className="working">
      <span className="spin" />
      {label}
      {s >= 8 && <span className="num" style={{ color: "var(--accent-text)" }}>{s}s</span>}
    </span>
  );
}

function Message({ m, animate, onSend }: { m: ChatMessage; animate: boolean; onSend: (t: string) => void }) {
  const me = m.role === "user";
  return (
    <div className={`msg ${me ? "me" : "ai"}${m.failed ? " fail" : ""}`} style={animate ? undefined : { animation: "none" }}>
      {!me && m.agents && m.agents.length > 0 && (
        <div className="crew">
          {m.agents.map((a) => (
            <span key={a}>{a}</span>
          ))}
        </div>
      )}
      {!me && m.trace && m.trace.length > 0 && (
        <div className="trace">
          {m.trace.map((t, i) => (
            <div key={i}>{t}</div>
          ))}
        </div>
      )}
      <div className="bubble">
        <span className="who">{me ? "You" : "Sawbuck"}</span>
        {!me && m.streaming && !m.content ? <Working /> : m.content || (me && m.attachments?.length ? "Sent attachments" : "")}
      </div>
      {m.attachments && m.attachments.length > 0 && (
        <div className="attach">
          {m.attachments.map((a, i) => (
            <span key={`${a.name}-${i}`}>{a.name}</span>
          ))}
        </div>
      )}
      {!me && m.changes && m.changes.length > 0 && (
        <div className="changes">
          <div className="label" style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)" }}>
            What changed
          </div>
          {m.changes.map((c, i) => (
            <div className="ch" key={`${c.itemId}-${i}`}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.itemName || "Unnamed line"}</span>
              {c.field === "added" ? (
                <span className="add">+ {c.after}</span>
              ) : c.field === "removed" ? (
                <span className="rem">removed</span>
              ) : (
                <span className="muted">
                  {c.field}: <s>{c.before}</s> <b style={{ color: "var(--fg)" }}>{c.after}</b>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {!me && m.failed && m.retryText && !m.streaming && (
        <div className="suggest">
          <button onClick={() => onSend(m.retryText!)} style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>
            Retry that request
          </button>
        </div>
      )}
      {m.milestone && <div className="sumcard">{m.milestone}</div>}
      {m.summary && (
        <div className="sumcard">
          <span>
            <b>{m.summary.name}</b>
            <br />
            <span className="muted">{m.summary.itemCount} line items</span>
          </span>
          <b className="num" style={{ color: "var(--accent-text)" }}>
            {moneyWhole(m.summary.total)}
          </b>
        </div>
      )}
      {m.suggestions && m.suggestions.length > 0 && (
        <div className="suggest">
          {m.suggestions.map((s) => (
            <button key={s} onClick={() => onSend(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
