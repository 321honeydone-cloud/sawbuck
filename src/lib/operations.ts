import type { ChangeRecord, Estimate, Group, LineItem, Operation } from "./types";
import { recalcEstimate, round2 } from "./totals";

let idCounter = 0;
/** Stable-ish unique id; fine for client/session + seed use. */
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

function findGroupByName(estimate: Estimate, name: string): Group | undefined {
  const target = name.trim().toLowerCase();
  return estimate.groups.find((g) => g.name.trim().toLowerCase() === target);
}

function blankItem(groupId: string, position: number): LineItem {
  return {
    id: newId("li"),
    groupId,
    position,
    name: "",
    quantity: 1,
    unit: "EA",
    unitCost: 0,
    costType: "Other",
    builderCost: 0,
    markupPct: 0,
    markupAmount: 0,
    clientTotal: 0,
    supplier: null,
    supplierPrice: null,
    notes: null,
  };
}

const fmt = (v: string | number) =>
  typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v;

/**
 * Apply one structured operation to an estimate.
 * Returns the next estimate (fully recalculated) plus the human-readable change
 * records that feed the AI Update Review diff panel.
 */
export function applyOperation(
  estimate: Estimate,
  op: Operation
): { estimate: Estimate; changes: ChangeRecord[] } {
  // Work on a deep-ish clone so callers can diff/undo.
  let next: Estimate = {
    ...estimate,
    groups: estimate.groups.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i })) })),
  };
  const changes: ChangeRecord[] = [];

  switch (op.op) {
    case "add_group": {
      const position = op.position ?? next.groups.length + 1;
      const group: Group = {
        id: op._groupId ?? newId("grp"),
        position,
        name: op.name,
        items: [],
        subtotalBuilder: 0,
        subtotalClient: 0,
      };
      next.groups = [...next.groups, group];
      break;
    }

    case "add_line_item": {
      let group = findGroupByName(next, op.groupName);
      if (!group) {
        group = {
          id: newId("grp"),
          position: next.groups.length + 1,
          name: op.groupName,
          items: [],
          subtotalBuilder: 0,
          subtotalClient: 0,
        };
        next.groups = [...next.groups, group];
      }
      const item = blankItem(group.id, group.items.length + 1);
      item.name = op.name;
      item.quantity = op.quantity;
      item.unit = op.unit;
      item.unitCost = op.unitCost;
      item.costType = op.costType;
      // HoneyDone: only materials carry markup; labor ($100/hr) and other are billed at cost.
      item.markupPct = op.costType === "Material" ? next.markupDefault : 0;
      item.supplier = op.supplier ?? (op.costType === "Material" ? "Home Depot" : null);
      group.items = [...group.items, item];
      changes.push({
        itemId: item.id,
        itemName: item.name,
        field: "added",
        before: "—",
        after: `${op.quantity} ${op.unit} @ $${fmt(op.unitCost)}`,
      });
      break;
    }

    case "edit_line_item": {
      for (const g of next.groups) {
        const item = g.items.find((i) => i.id === op.id);
        if (!item) continue;
        const before = (item as unknown as Record<string, unknown>)[op.field];
        (item as unknown as Record<string, unknown>)[op.field] = op.value;
        changes.push({
          itemId: item.id,
          itemName: item.name,
          field: String(op.field),
          before: fmt(before as string | number),
          after: fmt(op.value),
        });
        break;
      }
      break;
    }

    case "delete_line_item": {
      for (const g of next.groups) {
        const item = g.items.find((i) => i.id === op.id);
        if (!item) continue;
        g.items = g.items.filter((i) => i.id !== op.id);
        changes.push({
          itemId: item.id,
          itemName: item.name,
          field: "removed",
          before: `$${fmt(item.clientTotal)}`,
          after: "—",
        });
        break;
      }
      break;
    }

    case "set_markup": {
      for (const g of next.groups) {
        for (const item of g.items) {
          if (op.target !== "all" && item.id !== op.target) continue;
          if (item.markupPct === op.pct) continue;
          changes.push({
            itemId: item.id,
            itemName: item.name,
            field: "markup",
            before: `${fmt(item.markupPct)}%`,
            after: `${fmt(op.pct)}%`,
          });
          item.markupPct = op.pct;
        }
      }
      if (op.target === "all") next.markupDefault = op.pct;
      break;
    }

    case "set_labor_rate": {
      for (const g of next.groups) {
        for (const item of g.items) {
          if (item.costType !== "Labor") continue;
          if (item.unitCost === op.rate) continue;
          changes.push({
            itemId: item.id,
            itemName: item.name,
            field: "unitCost",
            before: `$${fmt(item.unitCost)}`,
            after: `$${fmt(op.rate)}`,
          });
          item.unitCost = op.rate;
        }
      }
      break;
    }

    case "finalize": {
      next.status = "won";
      break;
    }
  }

  next = recalcEstimate(next);
  if (changes.length > 0) next.aiUpdateCount = next.aiUpdateCount + 1;
  return { estimate: next, changes };
}

/** Apply a batch of operations, accumulating all change records. */
export function applyOperations(
  estimate: Estimate,
  ops: Operation[]
): { estimate: Estimate; changes: ChangeRecord[] } {
  let current = estimate;
  const allChanges: ChangeRecord[] = [];
  for (const op of ops) {
    const result = applyOperation(current, op);
    current = result.estimate;
    allChanges.push(...result.changes);
  }
  return { estimate: current, changes: allChanges };
}

export { round2 };
