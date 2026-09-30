// Acceptance tests for the Jobber update path, against the in memory fake.
// Run: npm run test:push
//
// Covers the four acceptance tests from the spec without touching Jobber:
//   1. the split quote 20260089 re pushed lands OK with the subtotal matching
//      and tax on materials (after the one time tax confirmation)
//   2. a fake "Quote can't be blank" routes to safe_update
//   3. a non draft quote stops with zero writes
//   4. learning: an approved fix becomes a playbook entry, auto after 2
// plus the heal loop itself (FAILED_DELETE, FAILED_ADD, MISMATCH, the 2
// attempt limit), split detection on the real read payload, and payload
// normalizing for the MCP wrapper shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pushUpdate } from "../src/lib/jobberPush/push";
import { FakeJobberTransport, normalizeRead, normalizeUpdate } from "../src/lib/jobberPush/zapier";
import { MemoryPlaybookStore, matchPlaybook, recordApproval, deriveSignals } from "../src/lib/jobberPush/playbook";
import { compareReadBack, detectSplit } from "../src/lib/jobberPush/compare";
import { buildExpectedPush, titleFromScope } from "../src/lib/jobberPush/expected";
import { memorySink } from "../src/lib/jobberPush/sendLog";
import type { PushSettings } from "../src/lib/jobberPush/heal";
import { recalcEstimate } from "../src/lib/totals";
import type { Estimate, LineItem } from "../src/lib/types";

// ----- fixtures -----

function line(groupId: string, position: number, name: string, unitCost: number, costType: LineItem["costType"], markupPct = 0): LineItem {
  return {
    id: `${groupId}-${position}`,
    groupId,
    position,
    name,
    quantity: 1,
    unit: "LS",
    unitCost,
    costType,
    builderCost: 0,
    markupPct,
    markupAmount: 0,
    clientTotal: 0,
    supplier: null,
    supplierPrice: null,
    notes: null,
  };
}

/** Peter Pappas: carpentry $862 labor, materials $28 cost + 25% = $35. Subtotal $897. */
function pappasEstimate(withMaterials = true): Estimate {
  const items = [
    line("G1", 1, "Wall hooks (3) behind interior doors (4) and towel racks (8), install customer supplied hooks with rated anchors", 500, "Labor"),
    line("G1", 2, "Pictures and paintings, hang and level light wall art, per piece", 200, "Labor"),
    line("G1", 3, "Mirror, install, anchored into studs or rated heavy duty wall anchors", 100, "Labor"),
    line("G1", 4, "Metal letter P, locate framing, layout and level, hang on rated anchors", 62, "Labor"),
  ];
  if (withMaterials) items.push(line("G1", 5, "Hanging hardware lot, heavy duty hangers, toggle anchors", 28, "Material", 25));
  return recalcEstimate({
    id: "EST-20260089",
    projectId: "PRJ-1",
    name: "Hooks, towel racks and wall art",
    status: "draft",
    location: "Melbourne, FL",
    clientName: "Peter Pappas",
    markupDefault: 25,
    finishLevel: "medium",
    aiUpdateCount: 0,
    groups: [{ id: "G1", position: 1, name: "Carpentry", items, subtotalBuilder: 0, subtotalClient: 0 }],
    totals: { totalCost: 0, totalMarkup: 0, estimateTotal: 0, profitMargin: 0 },
  });
}

const TEXT = {
  title: "Hooks, towel racks and wall art install",
  scopeOfWork: "Install customer supplied hooks, towel racks, mirror, metal letter P and wall art with rated anchors. All work performed by HoneyDone Property Maintenance LLC.",
  exclusions: ["Permits or inspections", "Patching or painting old hanger holes"],
};

/** The quote as it sits in Jobber today (split: message says $1121.75, lines $897, tax 0). */
function splitFake(status = "draft") {
  const f = new FakeJobberTransport({
    quoteStatus: status,
    title: "General work",
    message: "Not included in this job scope:\n1. Permits or inspections\n\nGood $1121.75, Better $1429.91, Best $1429.91, this quote is the good price.",
    lineItems: [
      { id: "Z2lkOi8vSm9iYmVyL1F1b3RlTGluZUl0ZW0vMjMxMTE4MDE5", name: "Carpentry", description: "Wall hooks...", quantity: 1, unitPrice: 862, taxable: false },
      { id: "Z2lkOi8vSm9iYmVyL1F1b3RlTGluZUl0ZW0vMjMxMTE4MDIw", name: "Materials and supplies", description: "Hanging hardware lot", quantity: 1, unitPrice: 35, taxable: true },
    ],
  });
  f.taxRates = [{ id: "TAX-FL-7", name: "Florida sales tax 7%", rate: 7 }];
  return f;
}

function memSettings(initial: string | null = null): PushSettings & { id: string | null } {
  const s = {
    id: initial,
    async getTaxRateId() {
      return s.id;
    },
    async setTaxRateId(id: string) {
      s.id = id;
    },
  };
  return s;
}

function run(opts: Partial<Parameters<typeof pushUpdate>[0]> & { transport: FakeJobberTransport }) {
  const { sink } = memorySink();
  return pushUpdate({
    estimate: pappasEstimate(),
    text: TEXT,
    quoteRef: "66460097",
    playbook: new MemoryPlaybookStore(),
    settings: memSettings(),
    sink,
    ...opts,
  });
}

// ----- expected push -----

test("expected push: one labor line per group, one taxable materials line, subtotal is the cash total", () => {
  const exp = buildExpectedPush(pappasEstimate(), TEXT);
  assert.equal(exp.lines.length, 2);
  assert.equal(exp.lines[0].name, "Carpentry");
  assert.equal(exp.lines[0].unit_price, 862);
  assert.equal(exp.lines[0].taxable, false);
  assert.equal(exp.lines[1].name, "Materials and supplies");
  assert.equal(exp.lines[1].unit_price, 35);
  assert.equal(exp.lines[1].taxable, true);
  assert.equal(exp.subtotal, 897);
  assert.ok(exp.message.includes("Not included in this job scope:\n1. Permits or inspections"));
  assert.equal(titleFromScope(pappasEstimate()), "Wall hooks, pictures and paintings and mirror install");
});

// ----- acceptance 1: the split quote, re pushed -----

test("acceptance 1: split quote 20260089 re pushed lands OK, subtotal matches, tax applied after the one time confirm", async () => {
  const transport = splitFake();
  const playbook = new MemoryPlaybookStore();
  const settings = memSettings();
  const { store, sink } = memorySink();

  // First pass: lines and text land, but the tax entry needs Manny once.
  const first = await pushUpdate({ estimate: pappasEstimate(), text: TEXT, quoteRef: "66460097", transport, playbook, settings, sink });
  assert.equal(first.status, "STOPPED");
  assert.equal(first.stopCode, "NEEDS_MANNY");
  assert.equal(first.pendingEntry?.id, "seed-tax-missing");
  assert.equal(first.writes, 1);
  assert.equal(first.readBack?.subtotal, 897);
  assert.equal(first.compare?.subtotalMatch, true);
  assert.equal(first.compare?.textMatch, true);
  assert.equal(first.compare?.taxMissing, true);
  assert.equal(first.split, false, "after the write the quote is no longer split");
  assert.ok(store.some((e) => e.phase === "safe_update" && e.before && e.after), "send log carries before and after");

  // Manny confirms once from the chat box.
  const ok = await recordApproval(playbook, { entryId: "seed-tax-missing", fix: "apply_tax_rate", diagnosis: "" });
  assert.equal(ok.promoted, true);
  assert.equal(ok.entry.auto, true);

  // Second pass: apply_tax_rate looks up the rate, saves the id, re runs with tax.
  const second = await pushUpdate({ estimate: pappasEstimate(), text: TEXT, quoteRef: "66460097", transport, playbook, settings, sink });
  assert.equal(second.status, "SENT", JSON.stringify(second.attempts));
  assert.equal(second.readBack?.subtotal, 897);
  assert.ok((second.readBack?.taxAmount ?? 0) > 0, "tax on materials applied");
  assert.equal(second.readBack?.taxAmount, 2.45);
  assert.equal(second.readBack?.title, TEXT.title);
  assert.equal(settings.id, "TAX-FL-7", "jobberTaxRateId saved to the price book");
  assert.equal(second.attempts.filter((a) => a.ran).map((a) => a.fix).join(","), "apply_tax_rate");
  assert.equal(transport.quote.lineItems.length, 2, "no duplicate lines left behind");
});

// ----- acceptance 2: fake blank error routes to safe_update -----

test("acceptance 2: a fake 'Quote can't be blank' routes to safe_update through the playbook", async () => {
  const transport = splitFake();
  const playbook = new MemoryPlaybookStore();
  const res = await run({
    transport,
    playbook,
    estimate: pappasEstimate(false),
    initialError: "Quote can't be blank. Please include at least one line item.",
  });
  assert.equal(res.attempts[0].entryId, "seed-quote-blank");
  assert.equal(res.attempts[0].fix, "route_safe_update");
  assert.equal(res.attempts[0].ran, true);
  assert.equal(res.status, "SENT");
  assert.equal(transport.writes, 1);
  assert.equal(transport.calls.filter((c) => c.action === "safe_update").length, 1);
  const pb = await playbook.load();
  assert.equal(pb.entries.find((e) => e.id === "seed-quote-blank")?.hits, 1);
  assert.ok(pb.entries.find((e) => e.id === "seed-quote-blank")?.last_seen);
});

// ----- acceptance 3: non draft stops with no writes -----

test("acceptance 3: a non draft quote stops before any write", async () => {
  for (const status of ["awaiting_response", "approved", "converted", "archived"]) {
    const transport = splitFake(status);
    const playbook = new MemoryPlaybookStore();
    const res = await run({ transport, playbook });
    assert.equal(res.status, "STOPPED");
    assert.equal(res.stopCode, "BLOCKED_NOT_DRAFT");
    assert.equal(res.writes, 0);
    assert.equal(transport.writes, 0);
    assert.equal(transport.calls.filter((c) => c.action === "safe_update").length, 0);
    assert.ok(res.reason?.includes(status));
    assert.equal(res.pendingEntry?.fix, "stop_not_draft");
  }
});

test("update mode never creates: a quote that cannot be read stops, nothing else is called", async () => {
  const transport = splitFake();
  const res = await run({ transport, quoteRef: "99999999" });
  assert.equal(res.status, "STOPPED");
  assert.equal(res.stopCode, "READ_FAILED");
  assert.equal(transport.writes, 0);
});

// ----- heal loop -----

test("FAILED_DELETE heals: leftover old lines get deleted, quote ends with exactly the SawBUCK set", async () => {
  const transport = splitFake();
  transport.failNext({ status: "FAILED_DELETE" });
  const res = await run({ transport, estimate: pappasEstimate(false) });
  assert.equal(res.status, "SENT", res.reason ?? "");
  assert.equal(res.attempts.filter((a) => a.ran).map((a) => a.fix).join(","), "delete_remaining_old_lines");
  assert.ok(res.attempts[0].note.includes("old line"));
  assert.equal(transport.quote.lineItems.length, 1);
  assert.equal(transport.quote.lineItems[0].unitPrice, 862);
  assert.equal(res.writes, 2);
});

test("FAILED_ADD heals: missing lines get added, quote ends with exactly the SawBUCK set", async () => {
  const transport = splitFake();
  transport.failNext({ status: "FAILED_ADD" });
  const res = await run({ transport });
  assert.equal(res.attempts.filter((a) => a.ran).map((a) => a.fix).join(","), "add_missing_lines");
  assert.ok(res.attempts[0].note.includes("missing line"));
  assert.equal(transport.quote.lineItems.length, 2);
  assert.equal(res.compare?.subtotalMatch, true);
});

test("MISMATCH on subtotal re runs safe_update once", async () => {
  const transport = splitFake();
  transport.failNext({ status: "MISMATCH" });
  const res = await run({ transport, estimate: pappasEstimate(false) });
  assert.equal(res.status, "SENT");
  assert.equal(res.attempts.filter((a) => a.ran).map((a) => a.fix).join(","), "rerun_safe_update_once");
  assert.equal(res.writes, 2);
});

test("max 2 heal attempts, then stop with everything attached", async () => {
  const transport = splitFake();
  transport.failNext({ status: "FAILED_ADD" });
  transport.failNext({ status: "FAILED_ADD" });
  transport.failNext({ status: "FAILED_ADD" });
  const res = await run({ transport, estimate: pappasEstimate(false) });
  assert.equal(res.status, "STOPPED");
  assert.equal(res.stopCode, "HEAL_LIMIT");
  assert.equal(res.attempts.filter((a) => a.ran).length, 2);
  assert.equal(res.writes, 3);
  assert.ok(res.readBack, "latest read back attached");
  assert.ok(res.log.some((e) => e.phase === "heal_fix"), "send log attached");
  assert.ok(res.attempts.every((a) => a.before), "every attempt logs the before state");
});

test("empty title is built from the scope before the first write and does not spend a heal attempt", async () => {
  const transport = splitFake();
  const res = await run({ transport, estimate: pappasEstimate(false), text: { ...TEXT, title: "" } });
  assert.equal(res.status, "SENT");
  assert.equal(res.attempts[0].fix, "build_title_from_scope");
  assert.equal(res.attempts[0].n, 0);
  assert.ok(res.expected.title.length > 0);
  assert.ok(/install$/.test(res.expected.title), res.expected.title);
  assert.equal(transport.quote.title, res.expected.title);
  assert.equal(res.writes, 1);
});

test("GraphQL undefinedField is logged and flagged, never retried", async () => {
  const transport = splitFake();
  transport.failNext({ status: "FAILED_ADD", error: "GraphQL error: undefinedField 'unitCost' on type QuoteLineItem", leave: "untouched" });
  const playbook = new MemoryPlaybookStore();
  const res = await run({ transport, playbook, estimate: pappasEstimate(false) });
  assert.equal(res.status, "STOPPED");
  assert.equal(res.stopCode, "NEEDS_MANNY");
  assert.equal(res.pendingEntry?.id, "seed-undefined-field");
  assert.ok(res.reason?.includes("unitCost"));
  assert.equal(res.writes, 1);
  assert.ok(res.log.some((e) => e.phase === "heal_fix" && e.status === "FLAGGED"));
});

test("an error with no playbook entry stops as UNKNOWN_ERROR so the chat box takes over", async () => {
  const transport = splitFake();
  transport.failNext({ status: "FAILED_WEIRD", error: "Jobber: something new", leave: "untouched" });
  const res = await run({ transport, estimate: pappasEstimate(false) });
  assert.equal(res.status, "STOPPED");
  assert.equal(res.stopCode, "UNKNOWN_ERROR");
});

// ----- acceptance 4 (server half): learning -----

test("acceptance 4: an approved fix for an unknown error is learned, auto after 2 approvals, and then runs on its own", async () => {
  const playbook = new MemoryPlaybookStore();
  const signal = "FAILED_WEIRD";
  const one = await recordApproval(playbook, { signal, fix: "replay_approved_update", diagnosis: "Re run safe_update with SawBUCK's lines.", fixArgs: { with_tax: false, with_text: true } });
  assert.equal(one.learned, true);
  assert.equal(one.entry.source, "learned");
  assert.equal(one.entry.auto, false);
  assert.equal(one.entry.approvals, 1);
  const two = await recordApproval(playbook, { signal, fix: "replay_approved_update", diagnosis: "" });
  assert.equal(two.learned, false);
  assert.equal(two.promoted, true);
  assert.equal(two.entry.auto, true);
  const hit = matchPlaybook(await playbook.load(), deriveSignals({ status: "FAILED_WEIRD", error: "Jobber: something new" }));
  assert.equal(hit?.entry.id, one.entry.id);

  // Now the same error self heals.
  const transport = splitFake();
  transport.failNext({ status: "FAILED_WEIRD", error: "Jobber: something new", leave: "untouched" });
  const res = await run({ transport, playbook, estimate: pappasEstimate(false) });
  assert.equal(res.status, "SENT");
  assert.equal(res.attempts.filter((a) => a.ran).map((a) => a.fix).join(","), "replay_approved_update");
});

// ----- split state and payload shapes -----

const LIVE_READ_PAYLOAD = {
  isError: false,
  results: {
    data: {
      success: true,
      data: {
        status: "OK",
        id: "Z2lkOi8vSm9iYmVyL1F1b3RlLzY2NDYwMDk3",
        quoteNumber: "20260089",
        quoteStatus: "draft",
        title: "General work",
        message: "Not included in this job scope:\n1. Permits or inspections\n\nGood $1121.75, Better $1429.91, Best $1429.91, this quote is the good price.",
        clientName: "Peter Pappas",
        lineItems: [
          { id: "Z2lkOi8vSm9iYmVyL1F1b3RlTGluZUl0ZW0vMjMxMTE4MDE5", name: "Carpentry", description: "Wall hooks...", quantity: 1, unitPrice: 862, totalPrice: 862, taxable: false },
          { id: "Z2lkOi8vSm9iYmVyL1F1b3RlTGluZUl0ZW0vMjMxMTE4MDIw", name: "Materials and supplies", description: "Hanging hardware lot", quantity: 1, unitPrice: 35, totalPrice: 35, taxable: true },
        ],
        subtotal: 897,
        taxAmount: 0,
        total: 897,
      },
    },
    logs: ["Fetching Jobber quote for ref: 66460097"],
  },
};

test("normalizeRead unwraps the MCP result shape and the split badge fires on the live 20260089 payload", () => {
  const read = normalizeRead(LIVE_READ_PAYLOAD);
  assert.equal(read.quoteNumber, "20260089");
  assert.equal(read.quoteStatus, "draft");
  assert.equal(read.lineItems.length, 2);
  assert.equal(read.subtotal, 897);
  const exp = buildExpectedPush(pappasEstimate(), TEXT);
  const split = detectSplit(exp, read);
  assert.equal(split.split, true);
  assert.ok(split.reason?.includes("1121.75"));
  const c = compareReadBack(exp, read);
  assert.equal(c.subtotalMatch, true);
  assert.equal(c.textMatch, false);
  assert.equal(c.split, true);
  assert.equal(c.taxMissing, true);
});

test("normalizeRead also takes the MCP text content shape", () => {
  const wrapped = { content: [{ type: "text", text: JSON.stringify(LIVE_READ_PAYLOAD.results.data) }] };
  const read = normalizeRead(wrapped);
  assert.equal(read.id, "Z2lkOi8vSm9iYmVyL1F1b3RlLzY2NDYwMDk3");
});

test("normalizeUpdate keeps the step and Jobber error text on failure", () => {
  const r = normalizeUpdate({ results: { data: { status: "FAILED_DELETE", step: 3, error: "Line item delete failed", quote: { subtotal: 1759, taxAmount: 0, total: 1759, lineItems: [] } } } });
  assert.equal(r.status, "FAILED_DELETE");
  assert.equal(r.step, 3);
  assert.ok(r.error?.includes("delete failed"));
  assert.equal(r.quote?.subtotal, 1759);
});
