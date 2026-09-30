// Jobber transport. The update path talks to Jobber ONLY through the two
// custom Zapier code actions on the "HoneyDone Property Maintenance"
// connection (JobberCLIAPI):
//
//   sawbuck_quote_read         read only
//   sawbuck_quote_safe_update  add new lines, verify, delete old, tax, text, read back
//
// The built in Zapier "Update Quote" action is never called from here. It
// deletes every line before adding the new ones and Jobber rejects an empty
// quote, which is what left quotes split (new text, old prices).
//
// Transport is an interface so the orchestrator, the healer, and the tests can
// run against a fake. The real one is an MCP client over HTTP against the
// Zapier MCP server, configured by env:
//
//   ZAPIER_MCP_URL    the server URL from Zapier MCP settings
//   ZAPIER_MCP_TOKEN  optional bearer token (some URLs embed the key instead)
//
// Zapier exposes the actions two ways depending on the server: one tool per
// action (jobber_sawbuck_quote_read) or one generic execute_zapier_write_action
// that takes selected_api + action + params. This client lists the tools once
// and uses whichever shape the server has. Server only.

import type { ExpectedLine, JobberLine, JobberQuoteRead, SafeUpdateInput, SafeUpdateResult, SafeUpdateStatus } from "./types";

export const READ_ACTION = "code_action_jobbercliapi__sawbuck_quote_read";
export const SAFE_UPDATE_ACTION = "code_action_jobbercliapi__sawbuck_quote_safe_update";
export const SELECTED_API = "JobberCLIAPI";

export interface TaxRate {
  id: string;
  name: string;
  rate: number;
}

export interface JobberTransport {
  read(quoteRef: string): Promise<JobberQuoteRead>;
  safeUpdate(input: SafeUpdateInput): Promise<SafeUpdateResult>;
  /** Optional. Returns null when no tax rate lookup action is enabled. */
  listTaxRates?(): Promise<TaxRate[] | null>;
}

// ---------------------------------------------------------------------------
// Payload normalizing. The MCP result wraps the action output in a couple of
// layers ({results:{data:{success,data:{...}}}}) and the shape differs a bit
// between the generic and per action tools, so dig for the object that
// actually carries the quote or the safe_update status.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Breadth first search for the first object that looks like an action payload. */
export function findPayload(root: unknown, wantKeys: string[]): Obj | null {
  const queue: unknown[] = [root];
  let depth = 0;
  while (queue.length && depth < 400) {
    depth++;
    const cur = queue.shift();
    if (typeof cur === "string") {
      // MCP text content carries JSON as a string.
      const s = cur.trim();
      if (s.startsWith("{") || s.startsWith("[")) {
        try {
          queue.push(JSON.parse(s));
        } catch {
          /* not JSON */
        }
      }
      continue;
    }
    if (Array.isArray(cur)) {
      queue.push(...cur);
      continue;
    }
    if (!isObj(cur)) continue;
    if (wantKeys.every((k) => k in cur)) return cur;
    for (const v of Object.values(cur)) queue.push(v);
  }
  return null;
}

const num = (v: unknown, d = 0): number => {
  const n = typeof v === "string" ? Number(v.replace(/[$,]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : d;
};
const str = (v: unknown, d = ""): string => (v === null || v === undefined ? d : String(v));

export function normalizeLine(raw: unknown): JobberLine {
  const o = isObj(raw) ? raw : {};
  const quantity = num(o.quantity, 1);
  const unitPrice = num(o.unitPrice ?? o.unit_price, 0);
  return {
    id: o.id ? String(o.id) : undefined,
    name: str(o.name),
    description: str(o.description),
    quantity,
    unitPrice,
    totalPrice: num(o.totalPrice ?? o.total_price, quantity * unitPrice),
    taxable: !!o.taxable,
  };
}

/** Turn a raw read result into a JobberQuoteRead. Throws on an error payload. */
export function normalizeRead(raw: unknown): JobberQuoteRead {
  const p = findPayload(raw, ["lineItems"]) ?? findPayload(raw, ["quoteNumber"]) ?? findPayload(raw, ["status"]);
  if (!p) throw new Error("Jobber read returned nothing SawBUCK could parse.");
  const status = str(p.status, "OK").toUpperCase();
  if (status !== "OK" || (!p.lineItems && !p.quoteNumber)) {
    const err = str(p.error ?? p.message, "unknown error");
    throw new Error(`Jobber read failed (${status}): ${err}`);
  }
  const lineItems = Array.isArray(p.lineItems) ? p.lineItems.map(normalizeLine) : [];
  return {
    status,
    id: str(p.id),
    quoteNumber: str(p.quoteNumber),
    quoteStatus: str(p.quoteStatus).toLowerCase(),
    title: str(p.title),
    message: str(p.message),
    clientName: str(p.clientName),
    lineItems,
    subtotal: num(p.subtotal, lineItems.reduce((s, l) => s + (l.totalPrice ?? 0), 0)),
    taxAmount: num(p.taxAmount, 0),
    total: num(p.total, 0),
  };
}

/** Turn a raw safe_update result into a SafeUpdateResult. Never throws on a status payload. */
export function normalizeUpdate(raw: unknown): SafeUpdateResult {
  const p = findPayload(raw, ["status"]);
  if (!p) {
    return { status: "UNKNOWN", error: "safe_update returned nothing SawBUCK could parse.", raw };
  }
  const status = str(p.status, "UNKNOWN").toUpperCase();
  const quoteRaw = isObj(p.quote) ? p.quote : isObj(p.final) ? p.final : p;
  const quote: Partial<JobberQuoteRead> = {};
  if (quoteRaw !== p || "lineItems" in p) {
    const lines = Array.isArray(quoteRaw.lineItems) ? quoteRaw.lineItems.map(normalizeLine) : undefined;
    if (lines) quote.lineItems = lines;
    if ("subtotal" in quoteRaw) quote.subtotal = num(quoteRaw.subtotal);
    if ("taxAmount" in quoteRaw) quote.taxAmount = num(quoteRaw.taxAmount);
    if ("total" in quoteRaw) quote.total = num(quoteRaw.total);
    if ("title" in quoteRaw) quote.title = str(quoteRaw.title);
    if ("message" in quoteRaw) quote.message = str(quoteRaw.message);
    if ("quoteStatus" in quoteRaw) quote.quoteStatus = str(quoteRaw.quoteStatus).toLowerCase();
  }
  const errParts = [p.error, p.jobberError, p.userErrors, p.errors, p.message]
    .filter((v) => v !== undefined && v !== null && v !== "")
    .map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
  return {
    status,
    step: p.step !== undefined ? num(p.step) : undefined,
    error: errParts.length ? errParts.join(" | ") : undefined,
    quote: Object.keys(quote).length ? quote : undefined,
    raw,
  };
}

/** Line items go over the wire as a JSON string, per the action's input spec. */
export function lineItemsParam(lines: ExpectedLine[]): string {
  return JSON.stringify(
    lines.map((l) => ({
      name: l.name,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      taxable: !!l.taxable,
    }))
  );
}

// ---------------------------------------------------------------------------
// MCP over HTTP client (JSON-RPC 2.0, streamable HTTP transport).
// ---------------------------------------------------------------------------

interface McpTool {
  name: string;
  inputSchema?: unknown;
}

export class ZapierMcpTransport implements JobberTransport {
  private url: string;
  private token: string | undefined;
  private nextId = 1;
  private sessionId: string | null = null;
  private tools: Promise<McpTool[]> | null = null;

  constructor(url = process.env.ZAPIER_MCP_URL || "", token = process.env.ZAPIER_MCP_TOKEN) {
    this.url = url;
    this.token = token || undefined;
  }

  static configured(): boolean {
    return !!process.env.ZAPIER_MCP_URL;
  }

  private async rpc(method: string, params: unknown): Promise<unknown> {
    if (!this.url) {
      throw new Error("ZAPIER_MCP_URL is not set. Add the Zapier MCP server URL to .env so SawBUCK can reach Jobber.");
    }
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const id = this.nextId++;
    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    const text = await res.text();
    if (!res.ok) throw new Error(`Zapier MCP ${method} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    const msg = parseRpcBody(text, id);
    if (!msg) throw new Error(`Zapier MCP ${method}: empty reply`);
    if (isObj(msg.error)) {
      throw new Error(`Zapier MCP ${method}: ${str(msg.error.message, "error")}`);
    }
    return msg.result;
  }

  private async ensureInit(): Promise<McpTool[]> {
    if (!this.tools) {
      this.tools = (async () => {
        try {
          await this.rpc("initialize", {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "sawbuck", version: "1.0" },
          });
          // Notification, no id expected back. Best effort.
          await fetch(this.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
              ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
            },
            body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
          }).catch(() => {});
        } catch {
          // Some hosted servers skip the handshake. Carry on to tools/list.
        }
        const r = (await this.rpc("tools/list", {})) as Obj;
        return Array.isArray(r?.tools) ? (r.tools as McpTool[]) : [];
      })();
    }
    return this.tools;
  }

  /** Call one of the two actions by its Zapier action key. */
  async callAction(actionKey: string, params: Record<string, unknown>): Promise<unknown> {
    const tools = await this.ensureInit();
    const perAction = tools.find((t) => t.name === actionToToolName(actionKey));
    const generic = tools.find((t) => t.name === "execute_zapier_write_action");
    const instructions = `Run the ${actionKey.replace(/^code_action_jobbercliapi__/, "")} action with exactly these parameters. Do not change any value.`;
    let name: string;
    let args: Obj;
    if (perAction) {
      name = perAction.name;
      args = { instructions, ...params };
    } else if (generic) {
      name = generic.name;
      args = { selected_api: SELECTED_API, action: actionKey, params, instructions };
    } else {
      throw new Error(
        `Zapier MCP server has neither ${actionToToolName(actionKey)} nor execute_zapier_write_action enabled.`
      );
    }
    const result = (await this.rpc("tools/call", { name, arguments: args })) as Obj;
    if (result?.isError) {
      throw new Error(`Zapier action ${actionKey} errored: ${JSON.stringify(result.content ?? result).slice(0, 500)}`);
    }
    return result;
  }

  async read(quoteRef: string): Promise<JobberQuoteRead> {
    const raw = await this.callAction(READ_ACTION, { quote_ref: String(quoteRef) });
    return normalizeRead(raw);
  }

  async safeUpdate(input: SafeUpdateInput): Promise<SafeUpdateResult> {
    const params: Record<string, unknown> = {
      quote_id: input.quote_id,
      line_items: lineItemsParam(input.line_items),
    };
    if (input.title !== undefined) params.title = input.title;
    if (input.message !== undefined) params.message = input.message;
    if (input.tax_rate_id) params.tax_rate_id = input.tax_rate_id;
    if (input.expected_subtotal !== undefined) params.expected_subtotal = input.expected_subtotal.toFixed(2);
    const raw = await this.callAction(SAFE_UPDATE_ACTION, params);
    return normalizeUpdate(raw);
  }

  /** Tax rate lookup rides on an optional third action. Null when it is not enabled. */
  async listTaxRates(): Promise<TaxRate[] | null> {
    const tools = await this.ensureInit();
    const key = "code_action_jobbercliapi__sawbuck_tax_rates_read";
    const has = tools.some((t) => t.name === actionToToolName(key) || t.name === "execute_zapier_write_action");
    if (!has) return null;
    try {
      const raw = await this.callAction(key, {});
      const p = findPayload(raw, ["taxRates"]) ?? findPayload(raw, ["rates"]);
      const list = (p?.taxRates ?? p?.rates) as unknown;
      if (!Array.isArray(list)) return null;
      return list.filter(isObj).map((r) => ({ id: str(r.id), name: str(r.name ?? r.label), rate: num(r.rate ?? r.percentage) }));
    } catch {
      return null;
    }
  }
}

/** Zapier names per action tools "<app>_<action name>". */
export function actionToToolName(actionKey: string): string {
  return "jobber_" + actionKey.replace(/^code_action_jobbercliapi__/, "");
}

/** Accept a plain JSON body or an SSE stream and return the reply with our id. */
function parseRpcBody(text: string, id: number): Obj | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith("{")) {
    try {
      return JSON.parse(t) as Obj;
    } catch {
      return null;
    }
  }
  // SSE: lines of "data: {...}". Take the message that answers our id.
  let last: Obj | null = null;
  for (const line of t.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      const m = JSON.parse(line.slice(5).trim()) as Obj;
      if (m.id === id) return m;
      last = m;
    } catch {
      /* skip */
    }
  }
  return last;
}

// ---------------------------------------------------------------------------
// In memory fake. Simulates a Jobber quote closely enough to test the whole
// path: the draft guard, the add then delete order, forced failures, and read
// backs. Used by the acceptance tests and by dry runs.
// ---------------------------------------------------------------------------

export interface FakeQuoteState {
  id: string;
  quoteNumber: string;
  quoteStatus: string;
  title: string;
  message: string;
  clientName: string;
  lineItems: JobberLine[];
  taxRate: number; // 0.07 when a tax rate is applied
}

export interface FakeFailure {
  /** Fail the next safe_update with this status, then clear. */
  status: SafeUpdateStatus | string;
  /** Leave the quote in this shape after the failure (defaults to a realistic half state). */
  leave?: "half_added" | "half_deleted" | "untouched";
  error?: string;
}

export class FakeJobberTransport implements JobberTransport {
  quote: FakeQuoteState;
  writes = 0;
  reads = 0;
  calls: { action: string; params: unknown }[] = [];
  private nextLine = 1;
  private failures: FakeFailure[] = [];
  taxRates: TaxRate[] | null = null;

  constructor(seed: Partial<FakeQuoteState> & { lineItems?: Partial<JobberLine>[] } = {}) {
    this.quote = {
      id: seed.id ?? "Z2lkOi8vSm9iYmVyL1F1b3RlLzY2NDYwMDk3",
      quoteNumber: seed.quoteNumber ?? "20260089",
      quoteStatus: seed.quoteStatus ?? "draft",
      title: seed.title ?? "General work",
      message: seed.message ?? "",
      clientName: seed.clientName ?? "Peter Pappas",
      lineItems: (seed.lineItems ?? []).map((l) => this.mkLine(l)),
      taxRate: seed.taxRate ?? 0,
    };
  }

  private mkLine(l: Partial<JobberLine>): JobberLine {
    const quantity = l.quantity ?? 1;
    const unitPrice = l.unitPrice ?? 0;
    return {
      id: l.id ?? `LINE-${this.nextLine++}`,
      name: l.name ?? "",
      description: l.description ?? "",
      quantity,
      unitPrice,
      totalPrice: Math.round(quantity * unitPrice * 100) / 100,
      taxable: !!l.taxable,
    };
  }

  failNext(f: FakeFailure) {
    this.failures.push(f);
  }

  private totals() {
    const subtotal = r2(this.quote.lineItems.reduce((s, l) => s + (l.totalPrice ?? 0), 0));
    const taxable = r2(this.quote.lineItems.filter((l) => l.taxable).reduce((s, l) => s + (l.totalPrice ?? 0), 0));
    const taxAmount = r2(taxable * this.quote.taxRate);
    return { subtotal, taxAmount, total: r2(subtotal + taxAmount) };
  }

  snapshot(): JobberQuoteRead {
    const t = this.totals();
    return {
      status: "OK",
      id: this.quote.id,
      quoteNumber: this.quote.quoteNumber,
      quoteStatus: this.quote.quoteStatus,
      title: this.quote.title,
      message: this.quote.message,
      clientName: this.quote.clientName,
      lineItems: this.quote.lineItems.map((l) => ({ ...l })),
      ...t,
    };
  }

  async read(quoteRef: string): Promise<JobberQuoteRead> {
    this.reads++;
    this.calls.push({ action: "read", params: { quote_ref: quoteRef } });
    const ok = [this.quote.id, this.quote.quoteNumber, "66460097"].includes(String(quoteRef));
    if (!ok) throw new Error(`Jobber read failed (NOT_FOUND): no quote for ${quoteRef}`);
    return this.snapshot();
  }

  async safeUpdate(input: SafeUpdateInput): Promise<SafeUpdateResult> {
    this.calls.push({ action: "safe_update", params: input });
    if (input.quote_id !== this.quote.id) {
      return { status: "FAILED_ADD", step: 1, error: `Quote ${input.quote_id} not found` };
    }
    if (this.quote.quoteStatus !== "draft") {
      return { status: "BLOCKED_NOT_DRAFT", step: 0, error: `Quote is ${this.quote.quoteStatus}, only draft quotes can be updated` };
    }
    if (!input.line_items.length) {
      return { status: "BLOCKED_EMPTY_LINES", step: 0, error: "At least 1 line item is required" };
    }
    this.writes++;
    const oldIds = this.quote.lineItems.map((l) => l.id);
    const fresh = input.line_items.map((l) =>
      this.mkLine({ name: l.name, description: l.description, quantity: l.quantity, unitPrice: l.unit_price, taxable: l.taxable })
    );
    const forced = this.failures.shift();
    if (forced) {
      if (forced.status === "FAILED_ADD") {
        // Half the new lines made it on before Jobber choked.
        if (forced.leave !== "untouched") this.quote.lineItems.push(...fresh.slice(0, Math.max(1, Math.floor(fresh.length / 2))));
        return { status: "FAILED_ADD", step: 1, error: forced.error ?? "Jobber: line item add failed (throttled)" };
      }
      if (forced.status === "FAILED_DELETE") {
        this.quote.lineItems.push(...fresh);
        // Only some of the old ids got deleted.
        const keep = oldIds.slice(0, Math.ceil(oldIds.length / 2));
        this.quote.lineItems = this.quote.lineItems.filter((l) => !oldIds.includes(l.id) || keep.includes(l.id));
        return { status: "FAILED_DELETE", step: 3, error: forced.error ?? "Jobber: line item delete failed" };
      }
      if (forced.status === "MISMATCH") {
        this.quote.lineItems = fresh.map((l, i) => (i === 0 ? { ...l, unitPrice: l.unitPrice + 10, totalPrice: (l.totalPrice ?? 0) + 10 } : l));
        const t = this.totals();
        return { status: "MISMATCH", step: 2, error: `Expected subtotal ${input.expected_subtotal} but quote has ${t.subtotal}`, quote: this.snapshot() };
      }
      return { status: forced.status, step: 1, error: forced.error ?? `forced ${forced.status}` };
    }
    // The real order: add, verify, delete old, tax, then text.
    this.quote.lineItems.push(...fresh);
    this.quote.lineItems = this.quote.lineItems.filter((l) => !oldIds.includes(l.id));
    if (input.tax_rate_id) {
      const rate = this.taxRates?.find((t) => t.id === input.tax_rate_id)?.rate;
      this.quote.taxRate = rate !== undefined ? rate / 100 : 0.07;
    }
    if (input.title !== undefined) this.quote.title = input.title;
    if (input.message !== undefined) this.quote.message = input.message;
    const t = this.totals();
    if (input.expected_subtotal !== undefined && Math.abs(t.subtotal - input.expected_subtotal) > 0.01) {
      return { status: "MISMATCH", step: 5, error: `Expected subtotal ${input.expected_subtotal} but quote has ${t.subtotal}`, quote: this.snapshot() };
    }
    return { status: "OK", step: 5, quote: this.snapshot() };
  }

  async listTaxRates(): Promise<TaxRate[] | null> {
    return this.taxRates;
  }
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The transport the app uses. Fake when SAWBUCK_JOBBER_FAKE=1 (dev and tests). */
export function defaultTransport(): JobberTransport {
  if (process.env.SAWBUCK_JOBBER_FAKE === "1") return sharedFake();
  return new ZapierMcpTransport();
}

let fake: FakeJobberTransport | null = null;
/** One fake per process so the UI can push, stop, chat, and approve against the same quote. */
export function sharedFake(): FakeJobberTransport {
  if (!fake) {
    fake = new FakeJobberTransport({
      message: "Good $1121.75, Better $1429.91, Best $1429.91, this quote is the good price.",
      lineItems: [
        { name: "Carpentry", description: "Wall hooks, towel racks, wall art, mirror, letter P.", quantity: 1, unitPrice: 862, taxable: false },
        { name: "Materials and supplies", description: "Hanging hardware lot.", quantity: 1, unitPrice: 35, taxable: true },
      ],
    });
    fake.taxRates = [{ id: "TAX-FL-BREVARD", name: "Brevard County 7%", rate: 7 }];
  }
  return fake;
}
