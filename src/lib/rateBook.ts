// Rate book engine — a TypeScript port of the HoneyDone Quote Bot's
// quote_engine.py. Lets the app price a plain-English job the way Manny's
// Discord bot does: match each piece of work to a rate-book task, sum the flat
// final_price for each, add the trip fee, apply the military discount, and add
// the card surcharge. This is the "flat rate" half of the run-both model; the
// cost-plus breakdown lives in the existing line-item engine.
//
// The real prices live in src/data/rate_book.json (459 tasks). Drop your bot's
// rate_book.json in there to replace the sample.

export interface RateSettings {
  trip_fee: number;
  military_discount_pct: number;
  card_surcharge_pct: number;
  hourly_rate?: number;
  materials_markup_pct?: number;
  florida_sales_tax_pct?: number;
  [k: string]: unknown;
}

export interface RateTask {
  name: string;
  category: string;
  final_price: number | null;
  unit?: string;
  labor_minutes?: number;
  material_allowance?: number;
  market_override?: number | null;
  source_tag?: string | null;
  needs_price?: boolean; // taxonomy stub awaiting a real price; never quoted
  taxonomy_path?: string; // original Jobber-style "Labor > Trade > Task" path
  [k: string]: unknown; // tolerate any other columns
}

export interface RateBook {
  settings: RateSettings;
  tasks: RateTask[];
}

export interface MatchedLine {
  task: string;
  category: string;
  qty: number;
  unit: string; // rate-book unit (each, per visit, linear foot, ...)
  unitPrice: number;
  laborMinutes: number; // per unit, from the rate book
  materialAllowance: number; // per unit material cost, from the rate book
  confident: boolean; // false => bot would flag this line with (?)
}

export interface Unmatched {
  text: string;
  suggestions: string[];
}

export interface RateQuote {
  lines: MatchedLine[];
  unmatched: Unmatched[];
  subtotal: number;
  trip: number;
  discount: number;
  cash: number;
  card: number;
  military: boolean;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "for", "with", "on", "in",
  "my", "his", "her", "their", "client", "customer", "needs", "need",
  "wants", "want", "please", "would", "like", "get", "got", "some",
  "new", "old", "is", "are", "be", "this", "that", "it", "at", "by",
  "replace", "install", "repair", "fix", "fixing", "replacing",
  "installing", "repairing", "swap", "change", "put",
]);

const NUM_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, pair: 2, dozen: 12,
};

const MODIFIERS = new Set([
  "military", "veteran", "vet", "cash", "card", "asap", "today",
  "tomorrow", "urgent", "quote", "estimate",
]);

// Phrase -> exact rate-book task name. Ported from the bot's ALIASES.
const ALIASES: [string, string][] = [
  ["gutter clean", "Gutters, Clean Out"], ["clean gutter", "Gutters, Clean Out"],
  ["gutter cleanout", "Gutters, Clean Out"], ["gutters out", "Gutters, Clean Out"],
  ["gutter repair", "Gutters, Rapair"], ["fix gutter", "Gutters, Rapair"],
  ["new gutter", "Gutters, Install New"], ["install gutter", "Gutters, Install New"],
  ["gutter", "Gutters, Clean Out"],
  ["roof patch", "Patch, Shingle Roof"], ["patch roof", "Patch, Shingle Roof"],
  ["shingle", "Patch, Shingle Roof"], ["flat roof", "Patch, Flat Roof"],
  ["metal roof", "Patch, Metal Roof"], ["tile roof", "Patch, Tile Roof"],
  ["skylight", "Skylight, Seal"], ["chimney cap", "Chimney, Cap Install/Replace"],
  ["chimney", "Chimney, Sealing"],
  ["pressure wash", "Pressure Washing"], ["power wash", "Pressure Washing"],
  ["soft wash", "Pressure Washing"], ["junk haul", "Junk Hauling"],
  ["haul off", "Junk Hauling"], ["haul away", "Junk Hauling"], ["haul", "Junk Hauling"],
  ["junk", "Junk Hauling"], ["debris", "Junk Hauling"], ["dump run", "Junk Hauling"],
  ["tree trim", "Tree Removal/Trimming"], ["tree removal", "Tree Removal/Trimming"],
  ["trim tree", "Tree Removal/Trimming"], ["tree", "Tree Removal/Trimming"],
  ["mailbox", "Install Mailboxes"], ["mister", "Install Misters"],
  ["landscap", "Landscaping, General Skills"],
  ["ceiling fan install", "Fixture, Ceiling Fan, Install New"],
  ["install ceiling fan", "Fixture, Ceiling Fan, Install New"],
  ["new ceiling fan", "Fixture, Ceiling Fan, Install New"],
  ["ceiling fan", "Replace ceiling fan (standard)"],
  ["gfci", "GFCI Outlets, Replace/Install"], ["outlet", "Outlets, Replace/Install"],
  ["plug", "Outlets, Replace/Install"], ["dimmer", "Switches, Dimmable, Replace/Install"],
  ["3 way switch", "Switches, 3 Way, Replace/Install"], ["light switch", "Switches, Replace Install"],
  ["switch", "Switches, Replace Install"], ["chandelier", "Fixture, Chandelier, Replace/Install New"],
  ["can light", "Fixture, Can Lights, Replace/Install New"],
  ["recessed light", "Fixture, Can Lights, Replace/Install New"],
  ["vanity light", "Fixture, Vanity Light Bar, Replace/Install New"],
  ["porch light", "Fixture, Porch Light, Replace/Install New"],
  ["flood light", "Fixture, Sensored Flood, Install New"],
  ["light fixture", "Replace light fixture (standard)"],
  ["smoke detector", "Smoke/CO Detectors, Replace/Install New"],
  ["co detector", "Smoke/CO Detectors, Replace/Install New"],
  ["carbon monoxide", "Smoke/CO Detectors, Replace/Install New"],
  ["doorbell", "Doorbell, Wireless, Replace/Install"], ["exhaust fan", "Exhaust Fan, Replace Unit"],
  ["bathroom fan", "Exhaust Fan, Replace Unit"], ["vent fan", "Exhaust Fan, Replace Unit"],
  ["circuit breaker", "Circuit Breakers, Replace"], ["breaker", "Circuit Breakers, Replace"],
  ["garbage disposal install", "Sink, Kitchen, Install New Garbage Disposal"],
  ["garbage disposal", "Sink, Kitchen, Replace Garbage Disposal"],
  ["disposal", "Sink, Kitchen, Replace Garbage Disposal"],
  ["leaky faucet", "Sink, Kitchen, Repair Faucet"], ["leaking faucet", "Sink, Kitchen, Repair Faucet"],
  ["dripping faucet", "Sink, Kitchen, Repair Faucet"], ["faucet leak", "Sink, Kitchen, Repair Faucet"],
  ["faucet drip", "Sink, Kitchen, Repair Faucet"],
  ["kitchen faucet", "Sink, Kitchen, Replace Faucet"], ["bathroom faucet", "Sink, Bathroom, Replace Faucet"],
  ["bath faucet", "Sink, Bathroom, Replace Faucet"], ["faucet", "Sink, Kitchen, Replace Faucet"],
  ["water heater flush", "Water Heater, Flush"], ["flush water heater", "Water Heater, Flush"],
  ["water heater", "Water Heater, Replace Install New"], ["running toilet", "Toilet, Replace Flapper"],
  ["toilet flapper", "Toilet, Replace Flapper"], ["flapper", "Toilet, Replace Flapper"],
  ["toilet fill valve", "Toilet, Replace Fill Valve"], ["fill valve", "Toilet, Replace Fill Valve"],
  ["wax ring", "Toilet, Replace Wax Ring"], ["toilet clog", "Toilet, Unclog"],
  ["clogged toilet", "Toilet, Unclog"], ["unclog toilet", "Toilet, Unclog"],
  ["toilet seat", "Toilet, Replace Seat"], ["toilet", "Toilet, Replace"],
  ["shower head", "Tub/Shower, Replace Shower Head"], ["shower cartridge", "Tub/Shower, Replace Shower Cartridge"],
  ["shower valve", "Tub/Shower, Repair Valve Stems"], ["clogged sink", "Sink, Kitchen, Snake/Unclog"],
  ["unclog sink", "Sink, Kitchen, Snake/Unclog"], ["clogged drain", "Sink, Kitchen, Snake/Unclog"],
  ["dishwasher install", "Dishwasher, Replace"], ["dishwasher", "Dishwasher, Replace"],
  ["hose bibb", "Hose Bibb, Replace Bibb (Laundry Or Garden)"],
  ["hose bib", "Hose Bibb, Replace Bibb (Laundry Or Garden)"],
  ["shutoff valve", "Sink, Kitchen, Replace Shutoff Valve"], ["water softener", "Water Softener, Install New"],
  ["kitchen sink", "Sink, Kitchen, Replace Sink"], ["bathroom sink", "Sink, Bathroom, Replace Sink"],
  ["drywall patch and paint", "Drywall, Patch And Paint"], ["patch and paint", "Drywall, Patch And Paint"],
  ["drywall patch", "Drywall, Patch"], ["patch drywall", "Drywall, Patch"],
  ["hole in wall", "Drywall, Patch"], ["hole in the wall", "Drywall, Patch"],
  ["drywall texture", "Drywall, Texture"], ["nail pop", "Drywall, Nail Pop Repair"],
  ["drywall", "Drywall, Patch"], ["popcorn removal", "Popcorn, Remove"],
  ["remove popcorn", "Popcorn, Remove"], ["popcorn ceiling", "Popcorn, Remove"],
  ["tv mount", "TV Mount, Remove/Install"], ["mount tv", "TV Mount, Remove/Install"],
  ["mount a tv", "TV Mount, Remove/Install"], ["mirror", "Mirror, Remove/Install"],
  ["grab bar", "Grab Bars, Remove/Install"], ["shelving", "Shelving, Remove/Install"],
  ["shelves", "Shelving, Remove/Install"], ["shelf", "Shelving, Remove/Install"],
  ["closet rod", "Closet Rods, Remove/Install"], ["thermostat", "Thermostat, Replace"],
  ["baseboard", "Baseboard, Install/Replace"], ["crown moulding", "Crown Moulding, Install/Replace"],
  ["crown molding", "Crown Moulding, Install/Replace"], ["chair rail", "Chair Rail, Install/Replace"],
  ["wainscot", "Wainscott, Install/Replace"], ["shiplap", "Shiplap, Install/Replace"],
  ["wallpaper remove", "Wallpaper,Remove"], ["remove wallpaper", "Wallpaper,Remove"],
  ["wallpaper", "Wallpaper, Install New"], ["paint interior", "Paint, Full Interior"],
  ["interior paint", "Paint, Full Interior"], ["paint inside", "Paint, Full Interior"],
  ["paint exterior", "Paint, Full Exterior"], ["exterior paint", "Paint, Full Exterior"],
  ["fascia", "Fascia, Repair/Replace"], ["door casing", "Door Casing, Install/Replace"],
  ["window casing", "Window Casing, Install/Replace"], ["vinyl siding", "Siding, Vinyl, Repair/Replace"],
  ["siding", "Siding, Vinyl, Repair/Replace"], ["stucco", "Stucco, Repair"], ["brick", "Brick, Repair"],
  ["stone veneer", "Stone Veneer, Repair"], ["fireplace", "Fireplace, Repair"],
  ["backsplash", "Tile, Backsplash, Install/Repair"], ["tile floor", "Tile, Floor, Install/Repair"],
  ["floor tile", "Tile, Floor, Install/Repair"], ["shower tile", "Tile, Bathroom Walls, Install/Repair"],
  ["grout", "Grout, Replace/Repair"], ["regrout", "Grout, Replace/Repair"],
  ["caulk shower", "Tub/Shower, Caulk/Seal Surround"], ["caulk tub", "Tub/Shower, Caulk/Seal Surround"],
  ["carpet clean", "Carpet, Cleaning"], ["carpet stretch", "Carpet, Stretching"],
  ["carpet patch", "Carpet, Patching"], ["install carpet", "Carpet, Install New"],
  ["carpet", "Carpet, Install New"], ["laminate", "Laminate, Floating, Install New"],
  ["vinyl plank", "Vinyl, Plank, Floating, Install New"], ["lvp", "Vinyl, Plank, Floating, Install New"],
  ["wood floor", "Wood Floors, Install New"], ["hardwood", "Wood Floors, Install New"],
  ["refinish floor", "Wood Floors, Refinish"], ["fence gate", "Wood Gate, Build New Or Repair"],
  ["gate", "Wood Gate, Build New Or Repair"], ["fence repair", "Wood Picket, Repair/Replace Wooden Parts"],
  ["fix fence", "Wood Picket, Repair/Replace Wooden Parts"], ["new fence", "Wood Picket, Build New"],
  ["build fence", "Wood Picket, Build New"], ["chain link", "Chain Link, Repair/Replace Components"],
  ["fence", "Wood Picket, Repair/Replace Wooden Parts"], ["deck repair", "Deck, Repair/Replace Rotten Parts"],
  ["build deck", "Deck, Build New"], ["new deck", "Deck, Build New"], ["deck refinish", "Deck, Refinishing"],
  ["deck", "Deck, Repair/Replace Rotten Parts"], ["weatherstrip", "Exterior, Standard Entry, Replace Weather"],
  ["weather strip", "Exterior, Standard Entry, Replace Weather"], ["deadbolt", "Exterior, Standard Entry, Replace Deadbolt &"],
  ["door lock", "Exterior, Standard Entry, Replace Deadbolt &"], ["pocket door", "Interior, Pocket, Repair / Stuck Door"],
  ["barn door", "Interior, Barn, Install New"], ["screen door", "Exterior, Sliding Screen, Replace Door"],
  ["rescreen", "Exterior, Sliding Screen, Re-Screen"], ["re-screen", "Exterior, Sliding Screen, Re-Screen"],
  ["interior door", "Interior, Standard, Replace Door Only"], ["broken window", "Window Glass, Single Pane, Replace"],
  ["dual pane", "Window Glass, Dual Pane, Replace"], ["double pane", "Window Glass, Dual Pane, Replace"],
  ["blinds", "Window, Blinds, Standard Horizontal, Replace"], ["window lock", "Window, Locks, Replace/Repair"],
  ["replace window", "Window, Replace"], ["dryer vent", "Dryer, Full Vent Cleaning To Exterior"],
  ["range hood", "Range Hood, Replace/Install New"], ["microwave", "Above Range Microwave, Replace/Install New"],
  ["cabinet door", "Cabinet, Door, Replace"], ["cabinet pull", "Cabinet, Door And Drawer Pulls, Replace/Install"],
  ["cabinet knob", "Cabinet, Door And Drawer Pulls, Replace/Install"], ["countertop", "Cabinet Coutertops, Replace/Install"],
  ["vanity", "Cabinet, Vanity, Replace/Install"],
];

/** Scrub rate-book name junk: trailing &, /, commas, dangling "and/or", and
 * placeholder "Unknown" tokens that leaked in when the book was generated. */
export function cleanTaskName(s: string): string {
  let out = (s || "").replace(/\bUnknown\b/gi, " ");
  out = out.replace(/\s+/g, " ").trim();
  out = out.replace(/(\s*(&|\/|,|\band\b|\bor\b))+\s*$/i, "");
  return out.trim();
}

const norm = (t: string) =>
  t.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const tokens = (t: string) => norm(t).split(" ").filter((w) => w && !STOPWORDS.has(w));

const bigrams = (s: string) => {
  const out: string[] = [];
  const n = norm(s).replace(/ /g, "");
  for (let i = 0; i < n.length - 1; i++) out.push(n.slice(i, i + 2));
  return out;
};

/** Dice coefficient on character bigrams, stands in for difflib's ratio. */
function ratio(a: string, b: string): number {
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (!ba.length || !bb.length) return 0;
  const counts = new Map<string, number>();
  for (const g of ba) counts.set(g, (counts.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of bb) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      hits++;
      counts.set(g, c - 1);
    }
  }
  return (2 * hits) / (ba.length + bb.length);
}

export class RateBookEngine {
  private book: RateBook;
  private tasks: Map<string, RateTask>;
  private taskTokens: Map<string, Set<string>>;

  constructor(book: RateBook) {
    this.book = book;
    this.tasks = new Map();
    this.taskTokens = new Map();
    for (const t of book.tasks) {
      // Skip anything without a real price: unpriced taxonomy stubs (needs_price
      // or null/zero final_price) never enter matching, suggestions, or quotes.
      if (t.needs_price || t.final_price == null || !(t.final_price > 0)) continue;
      this.tasks.set(t.name, t);
      this.taskTokens.set(t.name, new Set(tokens(t.name)));
    }
  }

  get settings(): RateSettings {
    return this.book.settings;
  }

  /**
   * Repair vs replace tier swap. "repair", "replace" and friends are STOPWORDS
   * for fuzzy matching, and the aliases hardcode the Replace variants, so a
   * request like "repair the kitchen faucet" used to land on "Sink, Kitchen,
   * Replace Faucet" even though the book has a priced "Sink, Kitchen, Repair
   * Faucet". When the segment clearly asks for one tier and the matched task
   * name carries the other, look for the sibling task and use it if priced.
   */
  private tierSwap(name: string, segment: string): string {
    if (/repair\s*[\/&]\s*replace|replace\s*[\/&]\s*repair/i.test(name)) return name; // combined task, both tiers
    const wantsRepair = /\b(repair|fix|leak\w*|drip\w*|loose|wobbly|stuck)\b/i.test(segment) && !/\b(replace\w*|swap out|new)\b/i.test(segment);
    const wantsReplace = /\b(replace\w*|replacement|swap out)\b/i.test(segment) && !/\b(repair|fix)\b/i.test(segment);
    if (wantsRepair && /\breplace\b/i.test(name)) {
      const alt = name.replace(/\bReplace\b/i, "Repair");
      if (this.tasks.has(alt)) return alt;
    }
    if (wantsReplace && /\brepair\b/i.test(name)) {
      const alt = name.replace(/\bRepair\b/i, "Replace");
      if (this.tasks.has(alt)) return alt;
    }
    return name;
  }

  /**
   * Public lookup: the priced sibling task on the other repair/replace tier,
   * e.g. "Sink, Kitchen, Replace Faucet" -> the "Repair Faucet" task. Null when
   * the book has no priced sibling, or the name already covers both tiers
   * ("Repair/Replace" style names).
   */
  tierSibling(name: string, to: "Repair" | "Replace"): RateTask | null {
    const clean = (name || "").trim();
    if (/repair\s*[\/&]\s*replace|replace\s*[\/&]\s*repair/i.test(clean)) return null;
    const from = to === "Repair" ? /\bReplace\b/i : /\bRepair\b/i;
    if (!from.test(clean)) return null;
    const alt = clean.replace(from, to);
    return this.tasks.get(alt) ?? null;
  }

  /** Same idea for rooms: "leaky faucet in the bathroom" should not land on the
   * kitchen task when a priced bathroom sibling exists. */
  private roomSwap(name: string, segment: string): string {
    const wantsBath = /\b(bath|bathroom|vanity)\b/i.test(segment) && !/\bkitchen\b/i.test(segment);
    const wantsKitchen = /\bkitchen\b/i.test(segment) && !/\b(bath|bathroom|vanity)\b/i.test(segment);
    if (wantsBath && /\bKitchen\b/i.test(name)) {
      const alt = name.replace(/\bKitchen\b/i, "Bathroom");
      if (this.tasks.has(alt)) return alt;
    }
    if (wantsKitchen && /\bBathroom\b/i.test(name)) {
      const alt = name.replace(/\bBathroom\b/i, "Kitchen");
      if (this.tasks.has(alt)) return alt;
    }
    return name;
  }

  private aliasMatch(segment: string): string | null {
    const n = norm(segment);
    for (const [phrase, task] of ALIASES) {
      if (n.includes(phrase) && this.tasks.has(task)) return task;
    }
    return null;
  }

  private fuzzyMatch(segment: string): { name: string | null; score: number } {
    const segTokens = new Set(tokens(segment));
    if (!segTokens.size) return { name: null, score: 0 };
    let best: string | null = null;
    let bestScore = 0;
    for (const [name, ttoks] of this.taskTokens) {
      if (!ttoks.size) continue;
      let overlap = 0;
      for (const tk of segTokens) if (ttoks.has(tk)) overlap++;
      if (!overlap) continue;
      const coverQ = overlap / segTokens.size;
      const coverT = overlap / ttoks.size;
      const score = 0.6 * coverQ + 0.25 * coverT + 0.15 * ratio(segment, name);
      if (score > bestScore) {
        best = name;
        bestScore = score;
      }
    }
    return { name: best, score: bestScore };
  }

  private suggest(segment: string, n = 3): string[] {
    const segTokens = new Set(tokens(segment));
    const scored: [number, string][] = [];
    for (const [name, ttoks] of this.taskTokens) {
      let has = false;
      for (const tk of segTokens) if (ttoks.has(tk)) { has = true; break; }
      if (has) scored.push([ratio(segment, name), name]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, n).map(([, name]) => cleanTaskName(name));
  }

  private static splitSegments(text: string): string[] {
    return (
      text
        // Numbered-list markers ("1. Dripping faucet 2. Loose outlet") are item
        // separators, NOT quantities. Splitting on them keeps "2." from turning
        // into two faucets (that was the 9-sinks bug).
        .split(/[,;\n]|\s\d{1,2}[.)]\s| and | plus |&|\+/i)
        .map((p) => p.trim())
        // Intro phrases like "Please quote the following:" are not work items.
        .filter((p) => p && !p.endsWith(":"))
    );
  }

  private static quantity(segment: string): number {
    // A leading list marker ("2. Loose handle", "2) ...") is not a count.
    if (/^\s*\d+\s*[.)]/.test(segment)) return 1;
    // Dimensions like "10 by 12" or "10x12" are measurements, not counts.
    const isDim = /\b\d+\s*(?:x|by)\s*\d+\b/.test(segment.toLowerCase());
    const words = norm(segment).split(" ").filter(Boolean);
    const isPlural = (w: string) => /^[a-z]{3,}s$/.test(w) && !/(ss|us|ics|ous)$/.test(w);
    const asNum = (w: string): number | null =>
      /^\d+$/.test(w) ? parseInt(w, 10) : NUM_WORDS[w] ?? null;
    // A number (digit or spelled out) followed by a plural noun within a few
    // tokens is a real count: "three ceiling fans", "replace 5 outlets". Articles
    // ("a", "an") never trigger it, so "a dozen cabinets" reads as 12, not 1.
    for (let i = 0; i < words.length; i++) {
      if (words[i] === "a" || words[i] === "an") continue;
      const n = asNum(words[i]);
      if (!n || n < 1) continue;
      if (isDim && /^\d+$/.test(words[i])) continue; // skip dimension digits
      for (let j = i + 1; j <= i + 3 && j < words.length; j++) {
        if (isPlural(words[j])) return n;
      }
    }
    // Fallback: a bare leading count ("2 fixtures", "3 doors"), but never a
    // measurement or spec ("20 amp", "15 min") or a dimension.
    if (!isDim) {
      const lead = segment.match(/^\s*(\d+)\s*([a-z"']*)/i);
      if (lead) {
        const unit = /^(amps?|watts?|volts?|ft|foot|feet|in|inch|inches|sq|sqft|sf|lf|yd|yards?|gal|gallons?|hrs?|hours?|mins?|minutes?|days?)$/;
        if (!unit.test((lead[2] || "").toLowerCase())) return parseInt(lead[1], 10);
      }
    }
    return 1;
  }

  // Area-priced tasks (unit is per sq ft or per linear foot) take their quantity
  // from the area/length stated in the job, not a leading count. "install 850
  // sqft lvp" => 850. An each-priced task (electrical troubleshooting) ignores
  // this and stays a plain count. Returns null when nothing area-like is found.
  private static areaQuantity(segment: string, unit: string): number | null {
    const u = unit.toLowerCase();
    const txt = segment.toLowerCase();
    const isSqFt = /sq|square|\bsf\b/.test(u) && !/yard/.test(u);
    const isLinFt = /lin|\blf\b/.test(u);
    if (isSqFt) {
      const m = txt.match(/(\d+(?:\.\d+)?)\s*(?:sq\.?\s?ft|sq\.?ft|sqft|s\.?f\.?|sf|square\s*f(?:ee|oo)t)\b/);
      if (m) return parseFloat(m[1]);
    }
    if (isLinFt) {
      const m = txt.match(/(\d+(?:\.\d+)?)\s*(?:lin(?:ear)?\s*(?:ft|feet|foot)|lf|l\.?f\.?)\b/);
      if (m) return parseFloat(m[1]);
    }
    return null;
  }

  /** Square feet stated in a segment ("patch 15 sq ft of drywall" => 15), or null. */
  private static drywallSqft(seg: string): number | null {
    const m = seg.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(?:sq\.?\s?ft|sqft|sf|square\s*f(?:ee|oo)t)\b/);
    return m ? parseFloat(m[1]) : null;
  }

  match(text: string): { lines: MatchedLine[]; unmatched: Unmatched[] } {
    const raw: MatchedLine[] = [];
    const unmatched: Unmatched[] = [];
    for (const seg of RateBookEngine.splitSegments(text)) {
      if (norm(seg).split(" ").every((tok) => MODIFIERS.has(tok))) continue;
      const qty = RateBookEngine.quantity(seg);
      let name = this.aliasMatch(seg);
      let score = name ? 1 : 0;
      if (!name) {
        const f = this.fuzzyMatch(seg);
        name = f.name;
        score = f.score;
      }
      if (name && score >= 0.45) {
        name = this.roomSwap(this.tierSwap(name, seg), seg);
        const task = this.tasks.get(name)!;
        // Drywall patch/repair rule: flat $100 up to 10 sq ft, then $10 per sq ft
        // (a 10 sq ft minimum). Overrides the size-tier flat prices for any
        // "Drywall ... Patch" task; install, skim, texture, tape, and nail-pop
        // repairs keep their own rates.
        if (/drywall/i.test(name) && /patch/i.test(name)) {
          const sf = RateBookEngine.drywallSqft(seg);
          if (sf != null && sf >= 10) {
            raw.push({ task: "Drywall Patch / Repair", category: "Interior Walls & Ceilings", qty: sf, unit: "sq ft", unitPrice: 10, laborMinutes: 0, materialAllowance: 0, confident: true });
          } else {
            raw.push({ task: "Drywall Patch / Repair (10 sq ft minimum)", category: "Interior Walls & Ceilings", qty: 1, unit: "each", unitPrice: 100, laborMinutes: 0, materialAllowance: 0, confident: true });
          }
          continue;
        }
        const areaQty = RateBookEngine.areaQuantity(seg, String(task.unit ?? "each"));
        raw.push({
          task: cleanTaskName(name),
          category: cleanTaskName(task.category),
          qty: areaQty ?? qty,
          unit: String(task.unit ?? "each"),
          unitPrice: task.final_price as number,
          laborMinutes: Number(task.labor_minutes ?? 0),
          materialAllowance: Number(task.material_allowance ?? 0),
          confident: score >= 0.6,
        });
      } else {
        unmatched.push({ text: seg, suggestions: this.suggest(seg) });
      }
    }
    // Merge duplicates, preserving order.
    const merged = new Map<string, MatchedLine>();
    for (const li of raw) {
      const ex = merged.get(li.task);
      if (ex) ex.qty += li.qty;
      else merged.set(li.task, { ...li });
    }
    return { lines: [...merged.values()], unmatched };
  }

  quote(text: string): RateQuote {
    const military = /\bmilitary\b|\bveteran\b|\bvet\b/i.test(text);
    const { lines, unmatched } = this.match(text);
    const s = this.settings;
    const subtotal = lines.reduce((acc, li) => acc + li.unitPrice * li.qty, 0);
    const trip = s.trip_fee;
    let cash = subtotal + trip;
    let discount = 0;
    if (military) {
      discount = Math.round((cash * s.military_discount_pct) / 100);
      cash -= discount;
    }
    const card = Math.round(cash * (1 + s.card_surcharge_pct / 100));
    return { lines, unmatched, subtotal, trip, discount, cash: Math.round(cash), card, military };
  }
}

/** Labor dollars behind a task line, from its rate-book labor_minutes. */
export function laborCost(minutes: number, settings: RateSettings): number {
  return (Number(settings.hourly_rate ?? 100) * minutes) / 60;
}

/** Client-side material dollars (allowance plus the materials markup). */
export function materialClient(allowance: number, settings: RateSettings): number {
  return allowance * (1 + Number(settings.materials_markup_pct ?? 25) / 100);
}
