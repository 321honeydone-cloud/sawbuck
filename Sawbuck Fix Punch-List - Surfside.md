# Sawbuck AI: Surfside Failure Diagnosis and Fix Punch-List

**Date:** July 14, 2026
**Source:** the 7-14-2026 Surfside chat and estimate
**Scope requested:** a 14 item property turnover (flooring, two vanities, exterior door, wall AC, lights, front door locks, sand and repaint door, blinds, smoke detectors, move washer and dryer, window lock, door handle, fan globe, pressure wash).
**What shipped:** a 4 line, $340 quote covering one door adjustment, a trip charge, a Complications Cap, and one outlet. Roughly 13 of the 14 requested items never made it onto the quote.

This was not one bug. It was a chain, and each link made the next one worse. Below is every root cause with the evidence, the file, and the fix. Status is **LANDED** (changed today, project type-checks clean) or **TODO** (ready-to-apply code below, but it changes control flow or touches the database, so test it against the live app before shipping).

---

## Root causes, ranked

### 1. The Pricing agent priced your INSTRUCTIONS as if they were work. (LANDED)
This is the loudest failure and the one that poisoned the rate book.

Evidence from the log:
- You typed "using web search, try to fill in the incomplete items." It saved a rate for **"using web search" at $50**.
- "fill the estimate... divide them and organize them" saved **"divide them" $150** and **"general organization" $350**.
- "organizes them into categories and line numbers" saved **"organize items" $150** and **"line numbers" $150**.
- "add a new rate" saved a task literally named **"add a new rate" at $150**.

Why: `boss.ts` feeds every unmatched fragment of your message to `priceGaps()`, then `saveResearchedPrices()` writes it to the book. The only guard was `taskLikeGaps()` in `pricing.ts`, a weak deny-list of narrative words. Short command phrases sailed straight through.

Fix landed: added a `COMMAND` filter to `taskLikeGaps()` that blocks instruction verbs and app meta-words (divide, organize, sort, "web search", "line numbers", "add a new rate", "general handyman/maintenance/service", etc.). Verified: all 8 junk phrases from the log are now blocked, and real tasks (priming, door opening adjustment, sand) still pass. Because this is the single chokepoint before both pricing and saving, it stops the narration AND the rate-book writes.

### 2. It refuses to stub an unpriced line, so one missing rate kills the item. (TODO)
The whole job died on repeated **"I could not apply that change, so the estimate is untouched."** You said twice, "I will set the price by hand" and "I do not need a price, I can fill that in." The correct response is to drop the line in at $0 / TBD so you can fill it. Instead `estimator.ts` only creates lines three ways: the rate-book fast path, the rate-book append, or model operations that survive `verifyOperations()`. When the book misses and the local model does not emit a clean op, everything falls to `honestMiss()` and nothing lands. See the scope-decomposition builder in the TODO section.

### 3. One clarifying question aborted the entire 14 item build. (TODO)
The very first Surfside turn answered with "Before I price that I need a rough size..." and stopped. That is `clarifyNeeded()` firing on the flooring item, and `runEstimator()` does `return` right after streaming it. A single measured item (flooring) blocked the other 13 from ever being built. Fix: make the size question non-blocking on multi-item scopes. Code in the TODO section.

### 4. Trade detection only saw a slice of the job. (LANDED)
The list clearly spans Flooring, Plumbing (vanities), Electrical (lights, smoke detectors, fan), HVAC (wall AC), and general labor (blinds, washer and dryer). The Boss only ever detected Carpentry, Pressure Washing, and Doors, because `TRADE_KEYWORDS` had no Flooring or Appliance trade and was missing words like "vanity", "linoleum", "smoke detector", "blinds", "lights", "washer", "dryer".

Fix landed: added a **Flooring** trade and an **Appliances and Hauling** trade, and expanded Plumbing (vanity, medicine cabinet, shut-off) and Electrical (smoke detector, globe, lights, bulb). Now every Surfside item routes to a trade heading.

### 5. QA never checked requested scope against built lines. (LANDED)
"Boss QA: reviewed 0 lines, fixed 0, flagged 0" on almost every turn. The QA in `reviewStream()` counts lines, fills blanks, and checks the $2,500 cap, but it never asked the one question that mattered: you asked for 14 things, why is there 1 line?

Fix landed: added a scope-coverage check. When the request enumerates 3 or more numbered items and the estimate has fewer priced lines, it now lists exactly what is missing and says the items were not dropped on purpose. Verified: it parses all 14 Surfside items correctly, including the tricky "bedroom # 1" lines.

### 6. Regulated trades were never flagged for referral. (LANDED)
"Replace the wall AC unit" is HVAC, a refer-out under your own rules, and a flooring plus two vanities plus exterior door plus AC turnover almost certainly clears the $2,500 handyman cap. Nothing flagged either. The existing cap check keys off `baseTotal`, which stayed tiny ($275) precisely because the items were dropped, so it never fired. The remodel-language guard only matches words like "remodel" and "gut", which a numbered replacement list does not contain.

Fix landed: added a `REFER_OUT` guard in `reviewStream()` that flags HVAC, roofing, service-panel electrical, and structural work and tells you to price only the handyman-safe items and refer the rest. Verified: it flags the Surfside wall AC.

Still TODO (see below): make the $2,500 cap check estimate a rough total even when most lines are unpriced, so a big turnover cannot look small just because the book could not price it.

### 7. Brand-new researched rates were filed under "MARKET RESEARCH". (LANDED)
This is why the door landed under a "MARKET RESEARCH" category header in the estimate. In `pricingStore.ts`, any researched rate with no matching base task defaulted its category to the literal string `"Market Research"`. Every gemma-priced gap (including all the junk from #1) got dumped there.

Fix landed: changed the default category to **"General Service"**. New researched rates now land in a sane bucket instead of a nonsense one.

### 8. Pricing is non-deterministic. (TODO)
"general handyman service" came back $150, then $350, then $450 across three calls. gemma4 re-rolls a new number every time. Fix: cache the first estimate for a normalized task phrase and reuse it within a session, so the same gap never returns three different prices. Lower priority than 1 through 3.

---

## What I changed today (LANDED, type-checks clean)

Five edits across three files. The project compiles with zero type errors.

**`src/lib/agents/pricing.ts`** — new `COMMAND` deny-regex inside `taskLikeGaps()`, plus a `if (COMMAND.test(t)) continue;` line. Blocks instructions and meta-commands from ever being priced or saved.

**`src/lib/pricingStore.ts`** — default category for a new researched rate changed from `"Market Research"` to `"General Service"`.

**`src/lib/agents/boss.ts`** — four changes:
- `TRADE_KEYWORDS`: added Flooring and Appliances and Hauling trades; expanded Plumbing and Electrical keyword sets.
- New module-level `REFER_OUT` regex and `enumeratedItems()` helper.
- `reviewStream()`: added a scope-coverage QA block (lists missing items when an enumerated request is under-covered) and a refer-out compliance block.

> Note: three backup files (`pricing.ts.bak`, `pricingStore.ts.bak`, `boss.ts.bak`) were created during the edit and could not be deleted from this session because the handoff mount blocks unlink. They are inert. Delete them yourself when convenient.

---

## TODO: guardrail rewrites to land next

These are the higher-risk fixes. Each one changes control flow or touches the database, so drop them in and run a live Surfside test before shipping.

### A. Non-blocking clarify (fixes #3)
In `estimator.ts`, gate the single clarify-and-return so it only fires on a genuine single-task request, not a multi-item list.

```ts
// estimator.ts, add near the other detectors
function looksMultiItem(text: string): boolean {
  const markers = (text.match(/\d+\s*[).]/g) || []).length;      // "1) ... 2) ..."
  const conj = (text.match(/\b(and|also|then|plus)\b/gi) || []).length;
  const semis = (text.match(/[;\n]/g) || []).length;
  return markers >= 3 || conj + semis >= 3;
}

// in runEstimator(), replace the clarify block:
if (!hasItems) {
  const ask = clarifyNeeded(combined);
  if (ask && !looksMultiItem(combined)) {
    yield* streamText(ask);
    return;
  }
  // multi-item: do NOT abort. Build what we can, then ask the size question
  // as a trailing note instead of a hard stop (handled after the build).
}
```
Then append the measurement question at the end of a multi-item build instead of returning early, so flooring gets a "needs a size" note but the other 13 items still get built.

### B. Scope-decomposition builder: one line per requested item (fixes #2)
The core fix. When a request enumerates items the rate book cannot fully match, build a line for every item: priced from the book if matched, from a market finding if researched, otherwise a **TBD placeholder at $0** tagged "needs price". Never leave the estimate untouched when the user clearly listed work.

```ts
// new path in runEstimator(), before falling through to the model:
const items = enumeratedItems(combined); // export the helper from boss.ts or dupe it
if (items.length >= 3) {
  const eng = getRateBookEngine();
  for (const raw of items) {
    const q = eng.quote(raw);
    if (q.lines.length > 0) {
      const l = q.lines[0];
      yield { type: "operation", operation: { op: "add_line_item",
        groupName: l.category || "Additional Work", name: l.task,
        quantity: l.qty, unit: mapUnit(l.unit), unitCost: l.unitPrice, costType: "Other" } };
    } else {
      // stub it so the scope is visible and Manny can price by hand
      yield { type: "operation", operation: { op: "add_line_item",
        groupName: "Needs Pricing", name: raw, quantity: 1, unit: "LS",
        unitCost: 0, costType: "Other" } };
    }
  }
  yield* streamText("Laid in every item you listed. The ones under Needs Pricing have no rate in your book yet, so set a price on each before sending.");
  return;
}
```
This alone would have turned the Surfside 1-line quote into a 14-line quote with the unmatched items visible and waiting for a price, which is what you were asking for the whole time.

### C. Group-name whitelist (hardens #7)
The local model invented the "Market Research" style group once the market-pricing block was in its prompt. Constrain `normalizeOperation()` to snap any `groupName` that is not a known trade to the nearest trade or to "Additional Work", so a door can never land under a research bucket again.

### D. Meaningful cap math on unpriced scope (finishes #6)
In `reviewStream()`, when scope items are stubbed at $0, estimate a floor total (count of real scope lines times a conservative per-item figure, or the sum of any market findings) and run the $2,500 check against that, so a large turnover cannot read as a small job just because the book could not price it.

### E. Purge the polluted rate book (cleanup)
The junk rates from #1 are already saved in the `catalog` overrides row (`OVERRIDES_ID`). Filter #1 stops new pollution but does not remove what is already there. Write a one-off script to load the overrides JSON and delete any entry whose name matches the `COMMAND` pattern or whose category is "Market Research" with `source: "research"`. I can build this against your Prisma setup on request. Known junk to remove: using web search, divide them, general organization, organize items, line numbers, add a new rate, general handyman service, general maintenance checkup, general organization, priming (verify priming, it may be legit).

---

## Suggested acceptance test

Re-run the exact Surfside prompt against a clean estimate after B and A land. Pass criteria:
1. The estimate ends with 14 lines, one per requested item.
2. Unmatched items appear under "Needs Pricing" at $0, not dropped.
3. The wall AC line carries a refer-out flag.
4. No rate-book entry gets created for any word you typed as an instruction.
5. QA reports scope coverage as 14 of 14 (or names exactly which items are short).
