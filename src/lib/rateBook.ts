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
    return text.split(/[,;\n]| and | plus |&|\+/i).map((p) => p.trim()).filter(Boolean);
  }

  private static quantity(segment: string): number {
    const m = segment.match(/^\s*(\d+)\b/);
    if (m) return parseInt(m[1], 10);
    const first = norm(segment).split(" ")[0];
    return first && NUM_WORDS[first] ? NUM_WORDS[first] : 1;
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
        const task = this.tasks.get(name)!;
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
