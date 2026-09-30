// Jobber update path types. Shared by the server orchestrator, the healer
// chat, the API routes, and the push result sheet on the client.
//
// The shapes mirror what the two Zapier code actions on the Jobber connection
// return (sawbuck_quote_read and sawbuck_quote_safe_update), so nothing here
// is invented. Field names match the action output exactly.

/** One line item as Jobber reports it on a read back. */
export interface JobberLine {
  id?: string;
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice?: number;
  taxable: boolean;
}

/** Output of sawbuck_quote_read. */
export interface JobberQuoteRead {
  status: string; // OK on success
  id: string; // encoded GraphQL id, the only id safe_update accepts
  quoteNumber: string;
  quoteStatus: string; // draft | awaiting_response | approved | ...
  title: string;
  message: string;
  clientName: string;
  lineItems: JobberLine[];
  subtotal: number;
  taxAmount: number;
  total: number;
  error?: string;
}

/** One line SawBUCK wants on the quote. Exactly the safe_update line shape. */
export interface ExpectedLine {
  name: string;
  description: string;
  quantity: number;
  unit_price: number;
  taxable: boolean;
}

/** Inputs of sawbuck_quote_safe_update. */
export interface SafeUpdateInput {
  quote_id: string;
  line_items: ExpectedLine[];
  title?: string;
  message?: string;
  tax_rate_id?: string;
  expected_subtotal?: number;
}

export type SafeUpdateStatus =
  | "OK"
  | "MISMATCH"
  | "BLOCKED_NOT_DRAFT"
  | "BLOCKED_EMPTY_LINES"
  | "FAILED_ADD"
  | "FAILED_DELETE";

/** Output of sawbuck_quote_safe_update. Unknown statuses are kept as strings. */
export interface SafeUpdateResult {
  status: SafeUpdateStatus | string;
  step?: number;
  error?: string;
  quote?: Partial<JobberQuoteRead>;
  raw?: unknown;
}

/** What SawBUCK expects the Jobber quote to look like after the push. */
export interface ExpectedPush {
  title: string;
  message: string;
  lines: ExpectedLine[];
  subtotal: number;
  hasTaxable: boolean;
}

export interface LineDiff {
  /** Expected lines not found on the quote (by name and price). */
  missing: ExpectedLine[];
  /** Quote lines SawBUCK did not ask for. */
  extra: JobberLine[];
  matched: number;
}

export interface CompareResult {
  subtotalMatch: boolean;
  titleMatch: boolean;
  messageMatch: boolean;
  textMatch: boolean;
  /** Read back text and prices disagree (with SawBUCK, or with each other). */
  split: boolean;
  splitReason: string | null;
  expectedSubtotal: number;
  readSubtotal: number;
  delta: number;
  taxMissing: boolean;
  lineDiff: LineDiff;
}

export type PushStatus = "SENT" | "STOPPED";

export type SendLogPhase =
  | "start"
  | "read"
  | "guard"
  | "safe_update"
  | "read_back"
  | "compare"
  | "heal_match"
  | "heal_fix"
  | "heal_skip"
  | "chat_proposal"
  | "chat_approve"
  | "chat_cancel"
  | "learn"
  | "result";

export interface SendLogEntry {
  ts: string;
  pushId: string;
  estimateId: string;
  quoteRef: string;
  phase: SendLogPhase;
  status: string;
  note?: string;
  before?: unknown;
  after?: unknown;
  error?: string;
}

export type FixName =
  | "route_safe_update"
  | "delete_remaining_old_lines"
  | "add_missing_lines"
  | "rerun_safe_update_once"
  | "apply_tax_rate"
  | "build_title_from_scope"
  | "flag_undefined_field"
  | "stop_not_draft"
  | "replay_approved_update";

export interface PlaybookEntry {
  id: string;
  /** Error text or status this entry answers. Matched case-insensitively against the push signals. */
  match: string;
  diagnosis: string;
  fix: FixName;
  auto: boolean;
  hits: number;
  last_seen: string | null;
  source: "seeded" | "learned";
  /** Times Manny approved this fix from the chat box. */
  approvals?: number;
  /** When approvals reaches this number the entry flips to auto. */
  auto_after_approvals?: number | null;
  /** Options a replayed fix reuses (learned entries). */
  fix_args?: { with_tax?: boolean; with_text?: boolean } | null;
}

export interface HealAttempt {
  n: number;
  signal: string;
  entryId: string | null;
  match: string | null;
  fix: FixName | null;
  auto: boolean;
  ran: boolean;
  note: string;
  before: QuoteSnapshot | null;
  after: QuoteSnapshot | null;
}

/** Compact view of a quote for logs and diffs. */
export interface QuoteSnapshot {
  quoteStatus: string;
  title: string;
  message: string;
  lines: { name: string; description: string; quantity: number; unitPrice: number; taxable: boolean }[];
  subtotal: number;
  taxAmount: number;
  total: number;
}

export interface PushResult {
  status: PushStatus;
  pushId: string;
  estimateId: string;
  quoteRef: string;
  quoteId: string | null;
  /** Why the push stopped, plain English. */
  reason: string | null;
  /** Machine code for the stop: BLOCKED_NOT_DRAFT, UNKNOWN_ERROR, NEEDS_MANNY, HEAL_LIMIT, ... */
  stopCode: string | null;
  expected: ExpectedPush;
  readBack: JobberQuoteRead | null;
  compare: CompareResult | null;
  lastUpdate: SafeUpdateResult | null;
  attempts: HealAttempt[];
  log: SendLogEntry[];
  split: boolean;
  /** Playbook entry that needs Manny's say so, if that is why it stopped. */
  pendingEntry: PlaybookEntry | null;
  writes: number;
}

/** A Jobber write the healer chat wants to make. Nothing runs until Approve. */
export interface HealProposal {
  id: string;
  input: SafeUpdateInput;
  /** Plain English from the healer on why. */
  rationale: string;
  before: QuoteSnapshot | null;
  after: QuoteSnapshot;
  /** Signal that stopped the push, so an approval can teach the playbook. */
  signal: string | null;
  knownEntryId: string | null;
}
