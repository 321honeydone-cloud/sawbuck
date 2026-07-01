// Server-side constants for the local (Ollama) estimate engine:
// the HoneyDone system prompt used by the Estimator agent. The local model returns a
// JSON object { reply, operations } and the store applies the operations.
// (APPLY_OPERATIONS_TOOL below is the legacy Claude tool schema, kept only for
// reference / a future tool-calling provider.) Keep this out of client bundles.

import type { Estimate } from "./types";
import { HONEYDONE, catalogReference } from "./honeydone";

export const SYSTEM_PROMPT = `You are the AI estimator inside the HoneyDone estimating app. HoneyDone Property Maintenance LLC is a licensed and insured Florida property maintenance and repair contractor. You build job estimates the way HoneyDone prices them, from a plain-English description of the work.

Your job: turn what the user says into a structured, realistic HoneyDone estimate, and keep it updated as they ask for changes.

How HoneyDone prices (follow this exactly):
- Labor is billed at $${HONEYDONE.laborRate}/hr. Enter labor as costType Labor, unit HRS, unitCost ${HONEYDONE.laborRate}. The app keeps labor at 0% markup because the $${HONEYDONE.laborRate} rate already includes profit. Do not mark labor up.
- Materials: enter your COST as the unitCost (costType Material, with a supplier like Home Depot, Floor & Decor, Sherwin-Williams, or Ferguson when natural). The app automatically adds ${HONEYDONE.materialsMarkupPct}% on top for the client. So you enter raw cost, the client sees cost plus ${HONEYDONE.materialsMarkupPct}%.
- Every job gets a $${HONEYDONE.tripCharge} trip charge as a single Other line item named "Trip charge".
- Use the price book below for realistic Florida numbers. Scale quantities to the described scope. Pick mid-range materials unless told otherwise.

How you work:
- Reply in brief, friendly prose, 1 to 3 sentences. The spreadsheet shows the numbers, so do not re-list every line item in text. No em dashes and no semicolons in your replies, ever. Short, direct sentences.
- Whenever the estimate should change, you MUST put every change in the operations array of your JSON response. Saying you did it is not enough. If you tell the user you added, changed, or removed a line, there MUST be a matching operation in the operations array, or nothing actually happens. Never describe an edit you do not emit as an operation.
- Organize work into logical trade groups (for example Demo & Prep, Carpentry & Rot Repair, Drywall & Paint, Tile & Wet Areas, Fixtures & Finish, Exterior).
- To change existing items you MUST use their real id from the current estimate state below. Never invent ids.
- Use set_labor_rate only if the user wants a labor rate other than $${HONEYDONE.laborRate}. Use set_markup only to change a specific MATERIAL item's margin, never "all" (that would wrongly mark up labor). Use finalize only when the user says the estimate is done.

Operation reference (every change goes in the operations array of your JSON response):
- add_group: create a trade section.
- add_line_item: add a priced line to a group (creates the group if missing). Always include groupName, the trade section the line belongs in. If you are not sure which section, use a clear one like "Additional Work". Materials get ${HONEYDONE.materialsMarkupPct}% markup automatically, labor and other stay at 0%.
- edit_line_item: change one field (name, quantity, unit, unitCost, markupPct, supplier, costType) of an existing item by id.
- delete_line_item: remove an item by id.
- set_markup: change markup % on a specific material item id (avoid target "all").
- set_labor_rate: set the hourly rate on every Labor item (default is $${HONEYDONE.laborRate}).
- finalize: mark the estimate complete.

Keep edits minimal and targeted, only what the user asked for.

When the user attaches photos or PDFs (job-site pictures, plans, spec sheets, or a competitor quote), study them: identify the space, materials, fixtures, dimensions, and damage you can see, and build or adjust the estimate accordingly. Briefly mention what you saw in the attachment that drove your line items.

${catalogReference()}`;

/** Compact, id-bearing view of the estimate so the model can edit existing items. */
export function estimateContext(estimate: Estimate): string {
  const lines: string[] = [
    `Estimate "${estimate.name}" (${estimate.id}) — status ${estimate.status}, default materials markup ${estimate.markupDefault}%, location ${estimate.location ?? "Florida"}.`,
  ];
  if (estimate.groups.length === 0) {
    lines.push("The estimate is currently empty.");
  } else {
    for (const g of estimate.groups) {
      lines.push(`Group ${g.position}: ${g.name}`);
      for (const i of g.items) {
        lines.push(
          `  - id=${i.id} | ${i.name} | ${i.quantity} ${i.unit} @ $${i.unitCost} | ${i.costType} | markup ${i.markupPct}%`
        );
      }
    }
    lines.push(
      `Totals: cost $${estimate.totals.totalCost}, markup $${estimate.totals.totalMarkup}, client total $${estimate.totals.estimateTotal}.`
    );
  }
  return lines.join("\n");
}

const UNITS = ["HRS", "EA", "LS", "SF", "LF", "SY", "CY", "DAY"];
const COST_TYPES = ["Labor", "Material", "Other"];

// One tool whose input is the Operation[] the store already knows how to apply.
export const APPLY_OPERATIONS_TOOL = {
  name: "apply_operations",
  description:
    "Apply one or more structured operations to the current estimate. Call this whenever the estimate should change.",
  input_schema: {
    type: "object" as const,
    properties: {
      operations: {
        type: "array",
        description: "Ordered list of operations to apply.",
        items: {
          type: "object",
          oneOf: [
            {
              properties: {
                op: { const: "add_group" },
                name: { type: "string" },
                position: { type: "number" },
              },
              required: ["op", "name"],
            },
            {
              properties: {
                op: { const: "add_line_item" },
                groupName: { type: "string", description: "Target group; created if it doesn't exist." },
                name: { type: "string" },
                quantity: { type: "number" },
                unit: { type: "string", enum: UNITS },
                unitCost: { type: "number", description: "Per-unit cost (hourly rate for Labor, your material cost for Material)." },
                costType: { type: "string", enum: COST_TYPES },
                supplier: { type: ["string", "null"] },
              },
              required: ["op", "groupName", "name", "quantity", "unit", "unitCost", "costType"],
            },
            {
              properties: {
                op: { const: "edit_line_item" },
                id: { type: "string", description: "Existing line item id." },
                field: {
                  type: "string",
                  enum: ["name", "quantity", "unit", "unitCost", "markupPct", "supplier", "costType"],
                },
                value: { type: ["string", "number"] },
              },
              required: ["op", "id", "field", "value"],
            },
            {
              properties: {
                op: { const: "delete_line_item" },
                id: { type: "string" },
              },
              required: ["op", "id"],
            },
            {
              properties: {
                op: { const: "set_markup" },
                target: { type: "string", description: 'A specific material line item id (avoid "all").' },
                pct: { type: "number" },
              },
              required: ["op", "target", "pct"],
            },
            {
              properties: {
                op: { const: "set_labor_rate" },
                rate: { type: "number" },
              },
              required: ["op", "rate"],
            },
            {
              properties: { op: { const: "finalize" } },
              required: ["op"],
            },
          ],
        },
      },
    },
    required: ["operations"],
  },
};
