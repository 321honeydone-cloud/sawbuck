# HoneyDone Estimating — what changed

Took the generic Handoff clone and made it yours.

## 1. It prices like HoneyDone
New file `src/lib/honeydone.ts` is the brain with your real numbers and a price book.

- Labor billed at $100/hr, 0% markup (the rate already carries your profit)
- Materials entered at cost, the app adds 25% for the client automatically
- $100 trip charge on every job
- 3% card price shown in the totals bar next to the cash price
- A price book of your trades (carpentry and rot, drywall and paint, tile and wet areas, fixtures, pressure washing, decks and fences) at Florida pricing, fed straight into the AI
- Four ready job templates as quick-start buttons

The AI prompt was rewritten to follow all of this and to write the way you do (no em dashes, no semicolons, short and direct).

## 2. It looks like yours
Dark and gold industrial skin across the whole app. Gold hexagon saw blade badge, HoneyDone wordmark, Oswald and Barlow and Space Mono fonts, carbon weave background, gold accents.

## 3. One-click Jobber quote
A "Jobber Quote" button on any estimate turns the internal numbers into your client-facing fields (quote title, line item, one consolidated scope paragraph, cash and card price, exclusions, your GL closing line). No hourly math or markup shown. Copy all and paste into Jobber.

## 4. Description column that expands on hover
The description stays one line in the row so the row height never moves. Hover and a floating panel reveals the full text right over the line. Click it and that panel becomes an editable box. It floats above the table so nothing shifts around it.

## 5. Self-learning rate book
The app now learns from you and gets more comprehensive over time.

- Edit any line item (price, quantity, description, supplier) and click out. It saves to the estimate right away, the same as before.
- That edit also folds into a shop-wide rate book stored in the database. Same work at the same unit collapses to one entry, keeps your latest price, and counts how often you use it.
- Accepting an AI-built estimate teaches the book too.
- Every new estimate feeds the learned rates back into the AI, so the more you use it the closer it gets to exactly how you price.
- The book starts pre-loaded with your whole price book (40 items) and grows from there.
- New API at `src/app/api/rates` (GET to read the book, POST to fold in a rate). Logic lives in `src/lib/rates.ts`.

## 6. Per-line breakdown card (your eyes only)
Every line has a little arrow next to its number. Click it and the row expands into a card right underneath.

It leads with how the work actually gets done, so you can see how the estimate reasoned its way to the number:

- An ordered list of the install or work steps for that line (demo, prep, the core work, cleanup)
- A one line "why this size" rationale tying the hours or quantity to the scope
- Steps come from Claude and are tailored to the line. Offline it falls back to built-in steps by trade. Either way it caches, so it only thinks once per line until you change that line.

Under the steps it still lays the cost math bare:

- Quantity, unit cost, cost type, supplier
- Builder cost, the markup amount, the client total, and the card price for that one line
- A plain formula line: 24 LF x $9 = $216 cost, + 25% markup ($54), = $270 client, $278 card, plus the line margin

The client-facing Jobber quote still hides all of this. The breakdown lives only in your internal sheet. New API at `src/app/api/steps`, logic in `src/lib/steps.ts`.

## Run it
Built on Windows, so run these on your machine, not in the sandbox.

```
npm run db:seed     # loads the fascia sample job and the rate book (keeps existing data)
npm run dev         # start it at http://localhost:3000
```

Use `npm run db:reset` instead if you want a clean database from scratch. No schema migration is needed because the rate book reuses the existing Catalog table.

Your ANTHROPIC_API_KEY is already in .env, so the real Claude estimator is on. Without a key the app still runs on a built-in offline engine.

## Verified
- All app source compiles clean under TypeScript
- Estimating math tested: labor 0% / materials 25% / trip charge / card +3% / Jobber scope (14 checks passed)
- Rate book tested: seed builds 40 items, edits update in place and bump use count, new items append, learned rates flow into the prompt, bad data is ignored (18 checks passed)
- The Next production build, the database seed, and the description overlay's on-screen behavior should be checked on Windows, since the installed binaries (Prisma, esbuild, Next SWC) are Windows builds and cannot run in my Linux sandbox
