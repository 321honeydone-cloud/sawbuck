// Estimate data model, mirrors Handoff.ai spec section 5.

export type CostType = "Labor" | "Material" | "Other";
export type Unit = "HRS" | "EA" | "LS" | "SF" | "LF" | "SY" | "CY" | "DAY";
export type EstimateStatus = "draft" | "sent" | "won" | "archived" | "complete" | "invoiced";
export type FinishLevel = "low" | "medium" | "high" | "luxury";

// Good / better / best service tiers offered on a quote. Standard is the base
// HoneyDone build; Competitive trims scope and materials; Premium upgrades them.
export type ServiceTier = "competitive" | "standard" | "premium";

export interface LineItem {
  id: string;
  groupId: string;
  position: number; // display order within group; rendered as 1.1, 1.2, ...
  name: string; // full description
  quantity: number;
  unit: Unit;
  unitCost: number;
  costType: CostType;
  builderCost: number; // quantity * unitCost
  markupPct: number;
  markupAmount: number;
  clientTotal: number; // builderCost + markupAmount
  supplier: string | null; // e.g. "Lowes"
  supplierPrice: number | null;
  notes: string | null;
  media?: MediaItem[]; // photos/video carried from an inspection, shown in the breakdown
}

export interface Group {
  id: string;
  position: number; // 1, 2, 3
  name: string;
  items: LineItem[];
  subtotalBuilder: number;
  subtotalClient: number;
}

export interface Totals {
  totalCost: number; // sum of builderCost
  totalMarkup: number; // sum of markupAmount
  estimateTotal: number; // totalCost + totalMarkup
  profitMargin: number; // percentage
}

/** A client-facing exclusion line shown on the finalized quote. */
export interface Exclusion {
  id: string;
  text: string;
  included: boolean;
}

export interface Estimate {
  id: string; // EST-10002
  projectId: string; // PRJ-10001
  name: string;
  status: EstimateStatus;
  location: string | null;
  clientName?: string | null;
  clientAddress?: string | null;
  markupDefault: number;
  finishLevel: FinishLevel;
  aiUpdateCount: number;
  groups: Group[];
  totals: Totals;
  // In-memory only (not persisted): which service tier the working estimate
  // currently reflects, so the Jobber quote knows which tier to render.
  selectedTier?: ServiceTier;
  // Client-facing exclusions, editable and persisted, grow as the quote grows.
  exclusions?: Exclusion[];
}

/** One fully-built tier variant returned by /api/tiers. */
export interface TierVariant {
  tier: ServiceTier;
  name: string;
  groups: Group[];
  totals: Totals;
}

// ----- AI chat -----

export type ChatRole = "user" | "ai" | "system";

export type AttachmentKind = "image" | "pdf";

/** A file the user attached to a message, carried to the engine (base64 payload). */
export interface Attachment {
  name: string;
  kind: AttachmentKind;
  mediaType: string; // e.g. image/jpeg, image/png, application/pdf
  data: string; // base64, no data: prefix
}

/** Lightweight attachment descriptor kept on a ChatMessage for display. */
export interface AttachmentMeta {
  name: string;
  kind: AttachmentKind;
}

export interface SummaryCard {
  estimateId: string;
  name: string;
  itemCount: number;
  total: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  streaming?: boolean; // true while tokens are still arriving
  summary?: SummaryCard; // post-generation summary card
  milestone?: string; // milestone celebration banner text
  suggestions?: string[]; // next-action chips (Convert to invoice, etc.)
  trace?: string[]; // boss/employee routing notes, shown to admins only
  agents?: string[]; // trade crews that handled this turn, shown to everyone
  attachments?: AttachmentMeta[]; // files the user attached to this message
}

// ----- Structured AI operations (spec section 10) -----

export type Operation =
  | { op: "add_group"; name: string; position?: number; _groupId?: string }
  | {
      op: "add_line_item";
      groupName: string;
      name: string;
      quantity: number;
      unit: Unit;
      unitCost: number;
      costType: CostType;
      supplier?: string | null;
    }
  | { op: "edit_line_item"; id: string; field: keyof LineItem; value: string | number }
  | { op: "delete_line_item"; id: string }
  | { op: "set_markup"; target: "all" | string; pct: number }
  | { op: "set_labor_rate"; rate: number }
  | { op: "finalize" };

// A single reviewable change produced by the AI (spec section 6: AI Update Review).
export interface ChangeRecord {
  itemId: string;
  itemName: string;
  field: string;
  before: string;
  after: string;
}

// ----- Scout inspections -----

export type IssueSeverity = "critical" | "major" | "moderate" | "minor";

export interface MediaItem {
  type: "image" | "video";
  url: string; // /uploads/... path
}

export interface InspectionIssue {
  id: string;
  trade: string; // Plumbing, Electrical, Drywall, ...
  severity: IssueSeverity;
  defect: string; // what is wrong
  risk: string; // why it matters
  recommendation: string; // what to do
  transcript?: string; // raw narration
  media?: MediaItem[]; // photos and/or a video
  include?: boolean; // checked = goes onto the quote (default true)
  position: number;
  inspectorSet?: boolean; // true if the inspector explicitly stated the severity
}

export interface Inspection {
  id: string;
  name: string;
  location: string | null;
  status: string;
  userId?: string | null;
  issues: InspectionIssue[];
  createdAt?: string;
}
