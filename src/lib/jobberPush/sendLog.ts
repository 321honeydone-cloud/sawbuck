// The send log. Every push, every heal attempt, every chat proposal and
// approval lands here with the quote state before and after, newest last.
// JSON lines so a broken write never corrupts earlier entries and Manny can
// grep it. Path: data/send-log.jsonl (SAWBUCK_SEND_LOG_PATH to move it onto
// a persistent volume). Server only.

import { promises as fs } from "fs";
import path from "path";
import type { SendLogEntry, SendLogPhase } from "./types";

export const SEND_LOG_PATH = process.env.SAWBUCK_SEND_LOG_PATH || path.join(process.cwd(), "data", "send-log.jsonl");

/** Entries a single push run collects, then flushes to disk. */
export class SendLog {
  entries: SendLogEntry[] = [];
  constructor(
    public pushId: string,
    public estimateId: string,
    public quoteRef: string,
    private sink: (e: SendLogEntry) => Promise<void> = appendSendLog
  ) {}

  async add(phase: SendLogPhase, status: string, extra: Partial<SendLogEntry> = {}): Promise<SendLogEntry> {
    const e: SendLogEntry = {
      ts: new Date().toISOString(),
      pushId: this.pushId,
      estimateId: this.estimateId,
      quoteRef: this.quoteRef,
      phase,
      status,
      ...extra,
    };
    this.entries.push(e);
    try {
      await this.sink(e);
    } catch (err) {
      console.warn("[send-log] write failed:", (err as Error).message);
    }
    return e;
  }
}

let queue: Promise<void> = Promise.resolve();

export function appendSendLog(entry: SendLogEntry): Promise<void> {
  queue = queue
    .then(async () => {
      await fs.mkdir(path.dirname(SEND_LOG_PATH), { recursive: true });
      await fs.appendFile(SEND_LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
    })
    .catch((err) => {
      console.warn("[send-log] append failed:", (err as Error).message);
    });
  return queue;
}

/** Recent entries, optionally filtered. Newest last. */
export async function readSendLog(filter: { pushId?: string; estimateId?: string; quoteRef?: string } = {}, limit = 200): Promise<SendLogEntry[]> {
  let text = "";
  try {
    text = await fs.readFile(SEND_LOG_PATH, "utf8");
  } catch {
    return [];
  }
  const out: SendLogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as SendLogEntry;
      if (filter.pushId && e.pushId !== filter.pushId) continue;
      if (filter.estimateId && e.estimateId !== filter.estimateId) continue;
      if (filter.quoteRef && e.quoteRef !== filter.quoteRef) continue;
      out.push(e);
    } catch {
      /* skip a torn line */
    }
  }
  return out.slice(-limit);
}

/** No disk sink, for tests and dry runs. */
export const memorySink = () => {
  const store: SendLogEntry[] = [];
  return { store, sink: async (e: SendLogEntry) => void store.push(e) };
};

export function newPushId(): string {
  return `PUSH-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}
