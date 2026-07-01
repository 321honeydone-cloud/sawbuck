# Ratebook Pricing + Unit Fix Plan

Last updated: 2026-06-25. This is the working plan for filling the 696 unpriced stubs and fixing the units across the whole book. It refines Workstream 7 in SAWBUCK_PLAN.md. Pair with HANDOFF.md for technical state.

## Decisions locked (2026-06-25)
- Pricing method: HYBRID. Web market research sets a starting Melbourne price, then we back-fill labor minutes so the living engine and the market number agree.
- Geography: MELBOURNE / BREVARD only. Hyper-local to the real service area, not statewide.
- Units: fixed in the SAME pass as pricing. One sweep, units and prices land together.

## Where the book stands today
- rate_book.json holds 1,155 tasks. 459 priced, 696 empty stubs (no price, no labor minutes, just a taxonomy name).
- 1,154 of 1,155 tasks are stored as unit "each". Only the Trip Fee is not. So flooring, paint, drywall, baseboard, crown, fencing, carpet, tile are all sitting as "each" when they should be Sq ft or Linear ft. The unit fix is a full re-tag, not a touch-up.
- The 696 stubs by trade: Electrical 139, Doors 106, Plumbing 84, Appliances 57, Interior Walls & Ceilings 46, Window Coverings 41, Flooring 30, Cabinets 23, Landscaping 20, Carpentry 20, Fencing 18, Roofing 17, Fixtures/Mounts 17, Windows 13, HVAC 10, Data/Cable 10, plus smaller buckets.

## The good news on the code
The plumbing for this already exists. We are tuning, not building.
- Pricing agent `src/lib/agents/pricing.ts` already takes a `location` param (defaults to "Florida") and already returns the right units (each, sq ft, linear ft, hour, lump sum). Point it at Melbourne zips and it works.
- Edits write to the override row `CATALOG-RATE-OVERRIDES` (OVERRIDES_ID in src/lib/rateOverrides.ts), merged on top of the base book at read time. The static rate_book.json never gets rewritten, so edits survive rebuilds.
- Unit dropdown enum is EA / HRS / SF / LF (UNIT_CHOICES in EstimateSheet.tsx).
- The needs_price guard already keeps blank or 0 prices out of quotes.
- Scheduled job lives at `src/app/api/cron/ratebook/route.ts`.

---

## Where to find Melbourne pricing for labor

This is the real question. Sorted by how useful each source is for OUR taxonomy, because most "cost guides" are too coarse to map onto 696 specific tasks.

### Tier 1, per task and location aware (the workhorses)
These give a number at the same granularity as our task list, and they can be localized to Brevard.
- **Homewyse**. Enter a Brevard zip and it returns labor and material per task, zip adjusted. This is the single best free source because it is per task AND local. Use Melbourne 32901, West Melbourne 32904, 32935, Viera 32940, Rockledge 32955, Palm Bay 32907/32909. Pull a couple zips and average so one neighborhood does not skew it.
- **Thumbtack**. Shows real local pro quotes by zip for common tasks. Great reality check on what customers around here are actually being charged, weaker on obscure tasks.

### Tier 2, the labor wage anchor (grounds your $100/hr)
- **BLS OEWS, Palm Bay - Melbourne - Titusville metro**. Free and authoritative. Actual hourly wages for electricians, plumbers, carpenters, painters, drywall finishers in OUR metro. This does not price a task, it tells you whether the labor SHARE of each price is sane for this market and whether $100/hr holds up. Use it to sanity-check, not to set line prices.

### Tier 3, cost guides (regional multipliers, city pages when they exist)
- **Fixr, HomeGuide, Angi**. National ranges with regional adjustment, and some have Melbourne FL city pages. Good for filling gaps and cross-checking Tier 1, not precise enough to trust alone.

### Tier 4, gold standard but paid
- **RSMeans City Cost Index for Melbourne FL**. The pro construction-cost dataset. You take a national task cost and multiply by Melbourne's local index. Most defensible number you can get, but it is a subscription. Worth it only if this book becomes the spine of the business.

### Tier 5, the truth check (free and already yours)
- **Your own 459 priced tasks.** You already price in this market. Every new stub should land in the same logic as your existing book, not float off on its own.
- **Your Jobber history.** Real accepted prices from real Brevard jobs beat any website.
- **Reddit r/Handyman, r/Construction, ContractorTalk.** Sniff test for "is this number crazy," not a primary source.

### The recommendation
Anchor on Homewyse by Brevard zip for the per task numbers, since it is the only free source at our task granularity. Cross-check the common tasks against Thumbtack. Validate the labor share against BLS Palm Bay - Melbourne wages. Then reconcile every new price against your 459 existing tasks so the new 696 sit in the pricing logic you already use. RSMeans only if we decide to go all in.

---

## The plan, in phases

### Phase 0, source validation (do this first, small)
Before pricing 696 things, prove the sources actually deliver for Brevard at our granularity. Run a deep-research probe on about 10 representative tasks spread across trades (one electrical, one flooring per sq ft, one baseboard per linear ft, one appliance install, one drywall patch, etc). Confirm Homewyse returns Brevard-localized numbers and that the unit it implies matches what we expect. Output: a go or no-go on the source mix plus any gaps.

### Phase 1, unit re-tag map (rules, not guessing)
Build a deterministic rule that assigns the correct unit from each task name and category. First pass:
- Sq ft (SF): flooring install/replace, carpet, tile, paint walls/ceiling, drywall install/finish/texture, popcorn removal.
- Linear ft (LF): baseboard, crown, trim, casing, fencing, gutter, countertop edge, thresholds.
- Hours (HRS) or Day: hauling, equipment rental, excavator, general labor by time.
- Each (EA): appliance installs, door slabs, fixtures, mounts, single-unit swaps. This stays the default.
Run the rule over all 1,155 tasks, eyeball the output by trade, hand-fix the edge cases. This is where most of the value is, because a per sq ft task priced as "each" quotes wrong every time.

### Phase 2, Melbourne market pull (the deep search)
For each of the 696 stubs, get an all-in Melbourne price plus unit plus basis plus sources. Tune the existing pricing agent: pass `location` as the Brevard zips instead of "Florida", and feed it the corrected unit from Phase 1 so it prices per the right unit. Batch by trade to keep token cost sane and to make review easy (Electrical is the biggest at 139, do it as its own run).

### Phase 3, labor-minute back-fill (the hybrid step)
For each priced task, solve for the labor minutes that make the living engine reproduce the market price, given $100/hr, 25% material markup, and the material allowance. Now the engine and the market number agree, and any future edit you make stays internally consistent instead of drifting. Tasks priced per sq ft or per linear ft keep the area-aware quantity logic already in the engine.

### Phase 4, load and guard
Write everything through the override layer (`CATALOG-RATE-OVERRIDES`), never touch the base json. Keep the needs_price guard so anything still blank stays a stub and never leaks into a quote. Spot check a sample per trade in the Rate Book screen before trusting the batch.

### Phase 5, keep it current
Repoint the WS7 scheduled jobs at Brevard: daily fill of any remaining stubs, weekly correction pass, Monday web pricing search. Same machinery as today, just scoped local.

---

## Suggested order of work
0 (validate sources) first, it is cheap and saves a wrong 696-task run. Then 1 (units) because a wrong unit poisons a price. Then 2 and 3 trade by trade, starting with Electrical since it is the biggest bucket, so we learn the workflow on the hardest one. Then 4 (load) and 5 (schedule).

## Open questions to settle before Phase 2
- Pilot trade: confirm we start the pricing run on Electrical (139), or pick a smaller trade like Flooring (30) to shake out the workflow first.
- RSMeans: in or out. Free sources only, or budget for the paid index.
- Zip set: confirm the Brevard zips to average (Melbourne, West Melbourne, Viera, Rockledge, Palm Bay) match your actual service radius.
