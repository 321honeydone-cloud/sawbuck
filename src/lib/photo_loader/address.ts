// photo_loader: street address normalization.
//
// PM clients keep one subfolder per property, named by street address. Folder
// names drift ("8426 Stalwart Cir" vs Jobber's "8426 Stalwart Circle"), so both
// sides get normalized before comparing. The house number must match EXACTLY
// and a unit number must match when either side has one.

const SUFFIXES: Record<string, string> = {
  street: "st", st: "st",
  circle: "cir", cir: "cir", cr: "cir",
  drive: "dr", dr: "dr",
  avenue: "ave", ave: "ave", av: "ave",
  boulevard: "blvd", blvd: "blvd",
  court: "ct", ct: "ct",
  lane: "ln", ln: "ln",
  road: "rd", rd: "rd",
  place: "pl", pl: "pl",
  terrace: "ter", ter: "ter", terr: "ter",
  trail: "trl", trl: "trl",
  way: "way",
  parkway: "pkwy", pkwy: "pkwy",
  highway: "hwy", hwy: "hwy",
  loop: "loop",
  point: "pt", pt: "pt",
  cove: "cv", cv: "cv",
  square: "sq", sq: "sq",
  crossing: "xing", xing: "xing",
};

const DIRECTIONS: Record<string, string> = {
  north: "n", n: "n", south: "s", s: "s", east: "e", e: "e", west: "w", w: "w",
  northeast: "ne", ne: "ne", northwest: "nw", nw: "nw", southeast: "se", se: "se", southwest: "sw", sw: "sw",
};

const UNIT_WORDS = new Set(["unit", "apt", "apartment", "suite", "ste", "#", "no", "bldg", "building", "lot"]);

export interface NormalizedAddress {
  number: string | null;
  unit: string | null;
  /** Street words after the number, suffixes and directions collapsed. */
  street: string;
  /** "8426 stalwart cir" style key, unit appended when present. */
  key: string;
}

/** Normalize a street line: lowercase, strip punctuation, collapse suffixes and unit markers. */
export function normalizeAddress(raw: string): NormalizedAddress {
  const cleaned = (raw || "")
    .toLowerCase()
    .replace(/#/g, " # ")
    .replace(/[.,;:()'"’]/g, " ")
    .replace(/[-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Folder names for PM properties may carry a trailing note; keep only the
  // first comma-free chunk that starts with a number (the street line).
  const tokens = cleaned.split(" ").filter(Boolean);
  let number: string | null = null;
  let unit: string | null = null;
  const street: string[] = [];
  let i = 0;
  if (tokens.length && /^\d+[a-z]?$/.test(tokens[0])) {
    number = tokens[0];
    i = 1;
  }
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (UNIT_WORDS.has(t)) {
      const next = tokens[i + 1];
      if (next) {
        unit = next.replace(/^#/, "");
        i += 1;
      }
      continue;
    }
    if (SUFFIXES[t]) {
      street.push(SUFFIXES[t]);
      continue;
    }
    if (DIRECTIONS[t]) {
      street.push(DIRECTIONS[t]);
      continue;
    }
    // A bare trailing token like "2b" after the street is a unit too.
    if (i === tokens.length - 1 && street.length > 0 && /^\d+[a-z]?$/.test(t) && !unit) {
      unit = t;
      continue;
    }
    street.push(t);
  }
  const streetKey = street.join(" ");
  const key = [number, streetKey].filter(Boolean).join(" ") + (unit ? ` unit ${unit}` : "");
  return { number, unit, street: streetKey, key };
}

/** True when both lines describe the same property. House number exact, unit exact when present. */
export function addressesMatch(a: string, b: string): boolean {
  const na = normalizeAddress(a);
  const nb = normalizeAddress(b);
  if (!na.number || !nb.number) return false;
  if (na.number !== nb.number) return false;
  if ((na.unit || nb.unit) && na.unit !== nb.unit) return false;
  if (!na.street || !nb.street) return false;
  if (na.street === nb.street) return true;
  // Tolerate a missing suffix on one side ("8426 stalwart" vs "8426 stalwart cir"),
  // but never a different street name.
  const wa = na.street.split(" ");
  const wb = nb.street.split(" ");
  const shorter = wa.length <= wb.length ? wa : wb;
  const longer = wa.length <= wb.length ? wb : wa;
  if (longer.length - shorter.length !== 1) return false;
  return shorter.every((w, idx) => w === longer[idx]);
}

/** Does this folder name look like a property address (starts with a house number)? */
export function looksLikeAddress(name: string): boolean {
  return /^\d{1,6}[a-z]?\s+\S/i.test(name.trim());
}

/** Pull the street line out of a full address ("8426 Stalwart Circle, Melbourne, FL 32940"). */
export function streetLine(full: string): string {
  return (full || "").split(",")[0].trim();
}
