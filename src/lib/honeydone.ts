// HoneyDone Property Maintenance LLC — the estimating brain.
//
// This is what makes the AI price jobs the way Manny actually does: real labor
// rate, real materials markup, real trip charge, and a catalog of the line items
// HoneyDone runs on. The catalog + constants get rendered into the system prompt
// (see ai.ts) so Claude reaches for HoneyDone numbers, not generic ones.

import type { CostType, Operation, Unit } from "./types";

// ---------------------------------------------------------------------------
// Business constants (from the honeydone-jobber-quote skill — never guess these)
// ---------------------------------------------------------------------------

export const HONEYDONE = {
  company: "HoneyDone Property Maintenance LLC",
  glPolicy: "NXT7HVHV3Q-00-GL",
  state: "Florida",
  laborRate: 100, // $/hr — this is the billed rate, profit already baked in
  tripCharge: 100, // $ flat per job
  materialsMarkupPct: 25, // % added on top of material cost
  cardSurchargePct: 3, // % added when the client pays by card
  closingLine:
    "All work performed by HoneyDone Property Maintenance LLC, a licensed and insured Florida contractor. (GL Policy NXT7HVHV3Q-00-GL)",
} as const;

/** Price with the 3% card surcharge applied, rounded to a whole dollar. */
export const cardPrice = (cash: number) =>
  Math.round(cash * (1 + HONEYDONE.cardSurchargePct / 100));

// ---------------------------------------------------------------------------
// Catalog — the trades and line items HoneyDone runs, at real FL pricing.
// Material unitCost is the COST to HoneyDone; the engine adds the 25% markup.
// Labor unitCost is the billed $100/hr rate (no markup added).
// ---------------------------------------------------------------------------

export interface CatalogItem {
  name: string;
  unit: Unit;
  unitCost: number;
  costType: CostType;
  supplier?: string;
  note?: string;
}

export interface CatalogCategory {
  trade: string;
  items: CatalogItem[];
}

export const CATALOG: CatalogCategory[] = [
  {
    trade: "Mobilization & Cleanup",
    items: [
      { name: "Trip charge", unit: "LS", unitCost: 100, costType: "Other", note: "flat per job" },
      { name: "Job cleanup & debris haul-off", unit: "HRS", unitCost: 100, costType: "Labor" },
      { name: "Dumpster / disposal", unit: "LS", unitCost: 450, costType: "Other" },
    ],
  },
  {
    trade: "Demolition",
    items: [
      { name: "Selective demo & tear-out", unit: "HRS", unitCost: 100, costType: "Labor" },
      { name: "Contractor bags & disposal supplies", unit: "LS", unitCost: 60, costType: "Material", supplier: "Home Depot" },
    ],
  },
  {
    trade: "Carpentry & Rot Repair",
    items: [
      { name: "Carpentry / framing labor", unit: "HRS", unitCost: 100, costType: "Labor" },
      { name: "1x6 PVC fascia board", unit: "LF", unitCost: 9, costType: "Material", supplier: "Home Depot" },
      { name: "Pressure-treated 2x framing lumber", unit: "LF", unitCost: 3.25, costType: "Material", supplier: "Home Depot" },
      { name: "Vented vinyl soffit panel", unit: "SF", unitCost: 4.5, costType: "Material", supplier: "Home Depot" },
      { name: "Aluminum drip edge flashing", unit: "LF", unitCost: 2.4, costType: "Material", supplier: "Home Depot" },
      { name: "Exterior trim / 1x PVC", unit: "LF", unitCost: 6.5, costType: "Material", supplier: "Home Depot" },
    ],
  },
  {
    trade: "Drywall & Paint",
    items: [
      { name: "Drywall repair & finish labor", unit: "HRS", unitCost: 100, costType: "Labor" },
      { name: "1/2 in drywall sheet 4x8", unit: "EA", unitCost: 18, costType: "Material", supplier: "Home Depot" },
      { name: "Joint compound, tape & mesh", unit: "LS", unitCost: 45, costType: "Material", supplier: "Home Depot" },
      { name: "Painting labor", unit: "HRS", unitCost: 100, costType: "Labor" },
      { name: "Interior paint & primer", unit: "EA", unitCost: 42, costType: "Material", supplier: "Sherwin-Williams", note: "per gallon" },
      { name: "Exterior paint", unit: "EA", unitCost: 55, costType: "Material", supplier: "Sherwin-Williams", note: "per gallon" },
      { name: "Caulk, tape & masking supplies", unit: "LS", unitCost: 35, costType: "Material", supplier: "Home Depot" },
    ],
  },
  {
    trade: "Tile, Bath & Wet Areas",
    items: [
      { name: "Tile & regrout labor", unit: "HRS", unitCost: 100, costType: "Labor" },
      { name: "Porcelain / ceramic tile", unit: "SF", unitCost: 3.25, costType: "Material", supplier: "Floor & Decor" },
      { name: "Cement board & waterproofing", unit: "SF", unitCost: 2.75, costType: "Material", supplier: "Home Depot" },
      { name: "Epoxy grout", unit: "EA", unitCost: 38, costType: "Material", supplier: "Floor & Decor", note: "per kit" },
      { name: "Thinset mortar", unit: "EA", unitCost: 22, costType: "Material", supplier: "Home Depot", note: "per bag" },
      { name: "Commercial silicone & sealant", unit: "LS", unitCost: 28, costType: "Material", supplier: "Home Depot" },
    ],
  },
  {
    trade: "Fixtures & Finish",
    items: [
      { name: "Fixture install labor", unit: "HRS", unitCost: 100, costType: "Labor" },
      { name: "Toilet (comfort height)", unit: "EA", unitCost: 220, costType: "Material", supplier: "Home Depot" },
      { name: "Vanity with top", unit: "EA", unitCost: 320, costType: "Material", supplier: "Home Depot" },
      { name: "Faucet / valve & trim", unit: "EA", unitCost: 140, costType: "Material", supplier: "Ferguson" },
      { name: "Light fixture / exhaust fan", unit: "EA", unitCost: 95, costType: "Material", supplier: "Home Depot" },
      { name: "Door slab / prehung interior door", unit: "EA", unitCost: 95, costType: "Material", supplier: "Home Depot" },
    ],
  },
  {
    trade: "Exterior & Pressure Washing",
    items: [
      { name: "Pressure washing labor", unit: "HRS", unitCost: 100, costType: "Labor" },
      { name: "Driveway / paver sealer", unit: "EA", unitCost: 48, costType: "Material", supplier: "Home Depot", note: "per 5 gal" },
      { name: "Cleaning solution & sand", unit: "LS", unitCost: 65, costType: "Material", supplier: "Home Depot" },
      { name: "Gutter cleaning & reseal", unit: "HRS", unitCost: 100, costType: "Labor" },
    ],
  },
  {
    trade: "Decks, Fences & Outdoor",
    items: [
      { name: "Deck / fence labor", unit: "HRS", unitCost: 100, costType: "Labor" },
      { name: "Composite decking board", unit: "SF", unitCost: 4.8, costType: "Material", supplier: "Home Depot" },
      { name: "Pressure-treated decking", unit: "SF", unitCost: 2.6, costType: "Material", supplier: "Home Depot" },
      { name: "Aluminum / vinyl railing", unit: "LF", unitCost: 28, costType: "Material", supplier: "Home Depot" },
      { name: "Fence pickets & rails", unit: "LF", unitCost: 14, costType: "Material", supplier: "Home Depot" },
      { name: "Concrete footing bag", unit: "EA", unitCost: 7, costType: "Material", supplier: "Home Depot" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Job templates — ready-made scopes for the work HoneyDone does most.
// These power the quick-start chips and the mock engine fallback.
// ---------------------------------------------------------------------------

const li = (
  groupName: string,
  name: string,
  quantity: number,
  unit: Unit,
  unitCost: number,
  costType: CostType,
  supplier?: string | null
): Operation => ({ op: "add_line_item", groupName, name, quantity, unit, unitCost, costType, supplier });

export interface JobTemplate {
  key: string;
  label: string; // chip text shown in the UI
  prompt: string; // what gets sent to the AI when picked
  name: string; // estimate name
  intro: string; // mock-engine intro line (no em dashes, no semicolons)
  groups: { name: string; items: Operation[] }[];
}

export const JOB_TEMPLATES: JobTemplate[] = [
  {
    key: "fascia-rot",
    label: "Fascia & rot repair",
    prompt: "Front fascia replacement and rot repair, about 24 linear feet",
    name: "Fascia Replacement & Rot Repair",
    intro:
      "Fascia and rot repair. I scoped demo of the old board, the framing fix, new PVC fascia, fresh drip edge, and cleanup.",
    groups: [
      {
        name: "Demo & Prep",
        items: [
          li("Demo & Prep", "Remove deteriorated fascia and rusted drip edge", 5, "HRS", 100, "Labor"),
          li("Demo & Prep", "Trip charge", 1, "LS", 100, "Other"),
        ],
      },
      {
        name: "Carpentry & Rot Repair",
        items: [
          li("Carpentry & Rot Repair", "Repair subfascia framing at rot section", 4, "HRS", 100, "Labor"),
          li("Carpentry & Rot Repair", "1x6 PVC fascia board", 24, "LF", 9, "Material", "Home Depot"),
          li("Carpentry & Rot Repair", "Aluminum drip edge flashing", 24, "LF", 2.4, "Material", "Home Depot"),
          li("Carpentry & Rot Repair", "Install fascia, flash and seal", 6, "HRS", 100, "Labor"),
          li("Carpentry & Rot Repair", "Stainless fasteners & sealant", 1, "LS", 45, "Material", "Home Depot"),
        ],
      },
    ],
  },
  {
    key: "regrout-bath",
    label: "Regrout & re-caulk bath",
    prompt: "Regrout and re-caulk a tub-shower surround, replace failed grout and silicone",
    name: "Bathroom Regrout & Re-caulk",
    intro:
      "Tub and shower regrout. I scoped grinding out the old grout, new epoxy grout, fresh silicone, and a clean seal all around.",
    groups: [
      {
        name: "Prep & Regrout",
        items: [
          li("Prep & Regrout", "Trip charge", 1, "LS", 100, "Other"),
          li("Prep & Regrout", "Grind out failed grout and old caulk", 4, "HRS", 100, "Labor"),
          li("Prep & Regrout", "Epoxy grout", 2, "EA", 38, "Material", "Floor & Decor"),
          li("Prep & Regrout", "Regrout tub and shower surround", 6, "HRS", 100, "Labor"),
          li("Prep & Regrout", "Commercial silicone & sealant", 1, "LS", 28, "Material", "Home Depot"),
        ],
      },
    ],
  },
  {
    key: "drywall-paint",
    label: "Drywall patch & paint",
    prompt: "Patch a damaged drywall section in a bedroom and repaint the wall",
    name: "Drywall Patch & Paint",
    intro:
      "Drywall patch and repaint. I scoped cutting out the damage, new board, tape and texture, and paint to match the wall.",
    groups: [
      {
        name: "Drywall Repair",
        items: [
          li("Drywall Repair", "Trip charge", 1, "LS", 100, "Other"),
          li("Drywall Repair", "Cut out damage, patch and finish", 6, "HRS", 100, "Labor"),
          li("Drywall Repair", "1/2 in drywall sheet 4x8", 1, "EA", 18, "Material", "Home Depot"),
          li("Drywall Repair", "Joint compound, tape & mesh", 1, "LS", 45, "Material", "Home Depot"),
        ],
      },
      {
        name: "Paint",
        items: [
          li("Paint", "Prime and paint the wall", 4, "HRS", 100, "Labor"),
          li("Paint", "Interior paint & primer", 1, "EA", 42, "Material", "Sherwin-Williams"),
          li("Paint", "Caulk, tape & masking supplies", 1, "LS", 35, "Material", "Home Depot"),
        ],
      },
    ],
  },
  {
    key: "pressure-wash",
    label: "Pressure wash & seal",
    prompt: "Pressure wash a driveway and front walk, then seal the pavers",
    name: "Pressure Wash & Seal Driveway",
    intro:
      "Pressure wash and seal. I scoped washing the driveway and walk, re-sanding the joints, and sealing the pavers.",
    groups: [
      {
        name: "Wash & Seal",
        items: [
          li("Wash & Seal", "Trip charge", 1, "LS", 100, "Other"),
          li("Wash & Seal", "Pressure wash driveway and walk", 5, "HRS", 100, "Labor"),
          li("Wash & Seal", "Cleaning solution & joint sand", 1, "LS", 65, "Material", "Home Depot"),
          li("Wash & Seal", "Seal pavers", 4, "HRS", 100, "Labor"),
          li("Wash & Seal", "Driveway / paver sealer", 2, "EA", 48, "Material", "Home Depot"),
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Catalog reference block for the AI system prompt.
// ---------------------------------------------------------------------------

/** Compact, readable catalog the model can price from. */
export function catalogReference(): string {
  const lines: string[] = ["HoneyDone price book (material unitCost is your cost, the app adds 25% for the client):"];
  for (const cat of CATALOG) {
    lines.push(`\n${cat.trade}:`);
    for (const it of cat.items) {
      const sup = it.supplier ? ` [${it.supplier}]` : "";
      const note = it.note ? ` (${it.note})` : "";
      lines.push(`  - ${it.name}: ${it.costType}, ${it.unit} @ $${it.unitCost}${sup}${note}`);
    }
  }
  return lines.join("\n");
}
