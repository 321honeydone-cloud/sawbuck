"use client";

import { create } from "zustand";
import { estimateEngine, deriveJobName } from "@/lib/engine";
import { applyOperation } from "@/lib/operations";
import type { Attachment, ChangeRecord, ChatMessage, Estimate, EstimateStatus, Exclusion, LineItem } from "@/lib/types";
import { suggestExclusions } from "@/lib/exclusions";

const DEFAULT_NAMES = new Set(["", "New Estimate", "New HoneyDone Estimate", "Untitled Estimate", "Untitled"]);
const isDefaultName = (n: string) => DEFAULT_NAMES.has((n || "").trim());

let msgSeq = 0;
const nextMsgId = () => `m_${++msgSeq}_${msgSeq.toString(36)}`;
const nextExclId = () => `x_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

interface EstimateState {
  estimate: Estimate;
  messages: ChatMessage[];
  isStreaming: boolean;
  pendingChanges: ChangeRecord[] | null; // diff awaiting accept/reject
  snapshot: Estimate | null; // pre-AI state, for reject/undo
  highlightIds: Set<string>; // line items touched by the latest AI run
  autoNameTick: number; // bumps each time the AI auto-derives the name (drives the typing animation)

  hydrate: (estimate: Estimate, messages: ChatMessage[]) => void;
  sendMessage: (text: string, attachments?: Attachment[]) => Promise<void>;
  acceptChanges: () => void;
  rejectChanges: () => void;
  editLineItem: (id: string, field: keyof LineItem, value: string | number) => void;
  renameEstimate: (name: string) => void;
  setClient: (name: string) => void;
  setStatus: (status: EstimateStatus) => void;
  seedExclusions: (extra?: string[]) => void;
  addExclusion: (text: string) => void;
  toggleExclusion: (id: string) => void;
}

async function persist(estimate: Estimate) {
  try {
    await fetch("/api/estimate", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(estimate),
    });
  } catch {
    // Best-effort; the UI stays authoritative even if the save blips.
  }
}

function findItem(estimate: Estimate, id: string): LineItem | undefined {
  for (const g of estimate.groups) {
    const it = g.items.find((i) => i.id === id);
    if (it) return it;
  }
  return undefined;
}

/** Fold a line item into the shop rate book (fire-and-forget, best-effort). */
function learnRate(item: LineItem, source: "manual" | "ai") {
  if (!item.name?.trim() || !(item.unitCost > 0)) return;
  void fetch("/api/rates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: item.name,
      unit: item.unit,
      costType: item.costType,
      unitCost: item.unitCost,
      supplier: item.supplier,
      source,
    }),
  }).catch(() => {});
}

/** Fold a line into the LIVING flat-rate book (the Rate Book screen) as its
 * all-in client price per unit. Overwrites the matching task or adds it if new,
 * so the book stays current as jobs are priced. Fire-and-forget. */
function learnRateBook(item: LineItem, source: "manual" | "ai") {
  const name = item.name?.trim();
  if (!name) return;
  const qty = item.quantity > 0 ? item.quantity : 1;
  const allIn = item.clientTotal > 0 ? item.clientTotal / qty : item.unitCost;
  if (!(allIn > 0)) return;
  void fetch("/api/ratebook/learn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, unit: item.unit, allIn, source }),
  }).catch(() => {});
}

export const useEstimateStore = create<EstimateState>((set, get) => ({
  estimate: {
    id: "",
    projectId: "",
    name: "",
    status: "draft",
    location: null,
    markupDefault: 25,
    finishLevel: "medium",
    aiUpdateCount: 0,
    groups: [],
    totals: { totalCost: 0, totalMarkup: 0, estimateTotal: 0, profitMargin: 0 },
  },
  messages: [],
  isStreaming: false,
  pendingChanges: null,
  snapshot: null,
  highlightIds: new Set(),
  autoNameTick: 0,

  hydrate: (estimate, messages) => set({ estimate, messages }),

  sendMessage: async (text, attachments = []) => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || get().isStreaming) return;

    const history = get()
      .messages.filter((m) => m.role === "user" || m.role === "ai")
      .slice(-8)
      .map((m) => ({ role: m.role as "user" | "ai", content: m.content }));

    const userMsg: ChatMessage = {
      id: nextMsgId(),
      role: "user",
      content: trimmed,
      attachments: attachments.length ? attachments.map((a) => ({ name: a.name, kind: a.kind })) : undefined,
    };
    const aiMsg: ChatMessage = { id: nextMsgId(), role: "ai", content: "", streaming: true };

    const snapshot = get().estimate;
    set((s) => ({
      messages: [...s.messages, userMsg, aiMsg],
      isStreaming: true,
      snapshot,
      pendingChanges: null,
      highlightIds: new Set(),
    }));

    const collected: ChangeRecord[] = [];
    const touched = new Set<string>();

    const patchAi = (patch: Partial<ChatMessage>) =>
      set((s) => ({
        messages: s.messages.map((m) => (m.id === aiMsg.id ? { ...m, ...patch } : m)),
      }));

    try {
      for await (const delta of estimateEngine.send(trimmed, { estimate: get().estimate, attachments, history })) {
        switch (delta.type) {
          case "text":
            patchAi({ content: get().messages.find((m) => m.id === aiMsg.id)!.content + delta.text });
            break;
          case "operation": {
            const { estimate: nextEstimate, changes } = applyOperation(get().estimate, delta.operation);
            collected.push(...changes);
            for (const c of changes) touched.add(c.itemId);
            set({ estimate: nextEstimate, highlightIds: new Set(touched) });
            break;
          }
          case "summary": {
            const est = get().estimate;
            const itemCount = est.groups.reduce((n, g) => n + g.items.length, 0);
            patchAi({ summary: { estimateId: est.id, name: delta.name, itemCount, total: est.totals.estimateTotal } });
            break;
          }
          case "milestone":
            patchAi({ milestone: delta.text });
            break;
          case "suggestions":
            patchAi({ suggestions: delta.suggestions });
            break;
          case "agents":
            patchAi({ agents: delta.agents });
            break;
          case "trace":
            patchAi({ trace: [...(get().messages.find((m) => m.id === aiMsg.id)?.trace ?? []), delta.text] });
            break;
          case "name":
            if (isDefaultName(get().estimate.name)) {
              set((s) => ({ estimate: { ...s.estimate, name: delta.name }, autoNameTick: s.autoNameTick + 1 }));
            }
            break;
        }
      }
    } finally {
      patchAi({ streaming: false });
      if (collected.length > 0 && isDefaultName(get().estimate.name) && trimmed) {
        set((s) => ({ estimate: { ...s.estimate, name: deriveJobName(trimmed) }, autoNameTick: s.autoNameTick + 1 }));
      }
      set({ isStreaming: false, pendingChanges: collected.length ? collected : null });
      // Persist the AI's work immediately so navigating away never loses it.
      // The Accept/Reject bar stays as an in-session undo (reject re-saves the snapshot).
      if (collected.length > 0) void persist(get().estimate);
      if (collected.length > 0) get().seedExclusions();

      // Save the turn so the thread survives a reload and admins can read it.
      const finalAi = get().messages.find((m) => m.id === aiMsg.id);
      const meta: Record<string, unknown> = {};
      if (finalAi?.trace?.length) meta.trace = finalAi.trace;
      if (finalAi?.agents?.length) meta.agents = finalAi.agents;
      if (finalAi?.summary) meta.summary = finalAi.summary;
      if (finalAi?.milestone) meta.milestone = finalAi.milestone;
      if (finalAi?.suggestions?.length) meta.suggestions = finalAi.suggestions;
      const userMeta = userMsg.attachments?.length ? JSON.stringify({ attachments: userMsg.attachments }) : undefined;
      const aiMeta = Object.keys(meta).length ? JSON.stringify(meta) : undefined;
      void fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          estimateId: get().estimate.id,
          messages: [
            { role: "user", content: userMsg.content, meta: userMeta },
            { role: "ai", content: finalAi?.content ?? "", meta: aiMeta },
          ],
        }),
      }).catch(() => {});
    }
  },

  acceptChanges: () => {
    const { estimate, highlightIds } = get();
    for (const id of highlightIds) {
      const item = findItem(estimate, id);
      if (item) {
        learnRate(item, "ai");
        learnRateBook(item, "ai");
      }
    }
    set({ pendingChanges: null, snapshot: null, highlightIds: new Set() });
    void persist(estimate);
  },

  rejectChanges: () => {
    const snap = get().snapshot;
    if (snap) set({ estimate: snap });
    set({ pendingChanges: null, snapshot: null, highlightIds: new Set() });
    void persist(get().estimate);
  },

  editLineItem: (id, field, value) => {
    const { estimate } = applyOperation(get().estimate, { op: "edit_line_item", id, field, value });
    set({ estimate });
    void persist(estimate);
    const item = findItem(estimate, id);
    if (item) {
      learnRate(item, "manual");
      learnRateBook(item, "manual");
    }
  },

  renameEstimate: (name) => {
    const next = { ...get().estimate, name: name.trim() || "Untitled Estimate" };
    set({ estimate: next });
    void persist(next);
  },

  setClient: (name) => {
    const next = { ...get().estimate, clientName: name.trim() || null };
    set({ estimate: next });
    void persist(next);
  },

  setStatus: (status) => {
    const next = { ...get().estimate, status };
    set({ estimate: next });
    void persist(next);
  },

  seedExclusions: (extra = []) => {
    const est = get().estimate;
    const existing = est.exclusions ?? [];
    const have = new Set(existing.map((e) => e.text.trim().toLowerCase()));
    const additions: Exclusion[] = [];
    for (const raw of [...suggestExclusions(est), ...extra]) {
      const t = String(raw).trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (have.has(key)) continue;
      have.add(key);
      additions.push({ id: nextExclId(), text: t, included: true });
    }
    if (additions.length === 0) return;
    const next = { ...est, exclusions: [...existing, ...additions] };
    set({ estimate: next });
    void persist(next);
  },

  addExclusion: (text) => {
    const t = text.trim();
    if (!t) return;
    const est = get().estimate;
    const existing = est.exclusions ?? [];
    if (existing.some((e) => e.text.trim().toLowerCase() === t.toLowerCase())) return;
    const next = { ...est, exclusions: [...existing, { id: nextExclId(), text: t, included: true }] };
    set({ estimate: next });
    void persist(next);
  },

  toggleExclusion: (id) => {
    const est = get().estimate;
    const existing = est.exclusions ?? [];
    const next = { ...est, exclusions: existing.map((e) => (e.id === id ? { ...e, included: !e.included } : e)) };
    set({ estimate: next });
    void persist(next);
  },
}));
