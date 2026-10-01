# Sawbuck UI Spec (Option A, Harbor)

Last updated: 2026-10-01. This is the blueprint for the full-version UI redo. Open `design/sawbuck-ui-mockup.html` in a browser to click through it. Live copy: https://claude.ai/artifact/6Z28TC9ZaYpoPehYwZaJcm

Build this on top of the LATEST Sawbuck code (the build with the LIVE / TAX / HIDE $ / CLIENT / ALT line chips). That code was only on Manny's PC when this spec was written, so push it first. This branch is older.

## Decisions locked
- Feel: back to the Handoff feel. Chat on the left, quote on the right, clean and quiet. Jobber and Google Sheets are the visual references.
- The job is the anchor. Home is a list of job cards. A job holds its chat, quote, Scout photos and notes.
- Tapping a job opens straight into the chat + quote split.
- Users: Manny on phone and desktop.
- Desktop fills the whole screen. Every pane is drag-resizable like Excel, and widths are remembered.
- Phone: swipe between Chat and Quote. The line inspector is a bottom sheet.
- Per-line flags (LIVE, TAX, HIDE $, CLIENT, ALT) come OFF the rows. Rows show small colored dots. The switches live in a right-side inspector that opens when a line is selected.
- Always visible on the quote: Smooth, Max Cost, tier switch, exclusions. Line breakdowns open one at a time (in the inspector).
- Scout and Notes are tabs inside a job, not rail items.
- Rate book, Crew and admin, Memory, Settings move under a Shop menu.
- Light and dark both supported, following the device by default. Color scheme: Harbor (petrol + amber) with the two-tone backdrop.
- Smooth motion on every open, close and switch, like iOS and Android.

## App shell
- Left rail (desktop) or bottom bar (phone): logo, New (petrol), Jobs (solid amber with a job count badge), Ask AI, then Shop at the bottom.
- Three views: Home, Job, Shop. Moving deeper slides in from the right. Going back slides in from the left.

## Home
- Title, then 4 stat tiles: New leads, Need a quote, Quotes out ($), Won this month ($). Clicking a tile filters by that stage, and clicking again clears the filter.
- Search (client, address, job) and stage filter pills: All, Lead, Scouted, Quoted, Sent, Won, Done.
- Job card: stage pill, last touched date, job name, client, address, a 6-step progress bar (Lead to Done, amber while in progress, petrol once Won or Done), and the quote price or "No quote yet".
- Card hover: lifts 4px with a petrol-tinted shadow, an amber-to-petrol stripe sweeps across the top, and "Open >" slides in. Cards rise in one after another on load. On phone, "Open" always shows.

## Job screen
- Header: amber "All jobs" button, job name (click it for a job switcher dropdown with outlined status pills and a "See all jobs" link), client and address, stage pill, petrol Finalize button. Tabs: Quote, Scout (with a count), Notes.
- Panes: Chat | divider | Quote | divider | Inspector. Double-click a divider to reset it. The inspector column is closed until a line is selected.
- Totals strip (sticky): Smooth (petrol), Max Cost, Card 3%, then the Competitive / Standard / Premium switch.
- Quote grid: spreadsheet look with gridlines, a sticky column header, and shaded group bands. Columns are #, Item, Qty, Unit, Rate, Total, Flags. The Complications Cap group uses the orange ALT color. When the pane gets narrow, Qty, Unit and Rate drop out.
- Selecting a line tints it and puts a petrol bar on its left. Arrow keys move through lines, Esc closes the inspector.
- Inspector: group and line name, Qty / Unit / Rate fields, the 5 flag switches (each with a one-line description), "How it gets done" steps, the why note, cost math (base, tax, client, card), and Delete line.
- Exclusions sit under the grid. Unchecking one draws a line through it, then it folds away into a "+N struck" link. There's an add field at the bottom.
- Scout tab: issue cards with a photo area, severity, trade and an "In quote" checkbox.

### Flag meanings (CONFIRM with Manny, these were guessed from a screenshot)
| Flag | Assumed meaning | Dot / switch color |
|---|---|---|
| LIVE | Counts in the total | slate (light) / near white (dark) |
| TAX | Adds 7% to this line | teal |
| HIDE $ | No price on the client copy | gray, hollow ring dot |
| CLIENT | Shows on the client quote | purple |
| ALT | Max Cost only, if needed | orange |

Math used in the mockup: Smooth = all LIVE lines that are not ALT. Max Cost = Smooth + ALT lines.

## Shop
Tabs: Rate book, Crew & admin, Memory, Settings.
- Rate book: a progress card (stubs priced out of 696, plus counts for priced / need a price / edited / from jobs). Plain-English price bar: type a sentence, Match shows the matched task with old and new price, then Apply or Cancel. Search, trade dropdown, and a Needs price / All / Edited / From jobs switch. Editable grid (unit, price, labor min, material). Editing tints the row and shows Save. Edited rows get Reset. Status pills: Base, Edited, From job, Needs price.
- Crew & admin: Add person (name, role, 4-digit PIN). A card per person with avatar initials, role pill and PIN. Tap a card to expand their quotes. Each quote has Open, Chat (shows the transcript inline) and Delete (confirms inline).
- Memory: Lessons (editable, add, remove) and the Job log timeline with a bar showing events until the next distill.
- Settings: AI brain (Cloud / Local, pricing research on or off). Pricing defaults ($100/hr labor, 25% materials markup, $100 trip, 3% card, 7% tax, $2,500 Max Cost cap) with a Save / Undo bar that only appears after a change. Appearance: mode, text size, color scheme.

## Visual system
- Fonts: IBM Plex Sans (everything) and IBM Plex Mono (cost math only). Numbers use tabular figures.
- Corners: 6px on cards, buttons and inputs, 4px on small inputs. Pills are fully round.
- Accent rule: petrol is the primary action color (New, Finalize, Smooth total, selected line, your chat bubbles, Save). Amber is for getting around (Jobs, All jobs, stage filters). Everything else stays neutral.

### Tokens
| Token | Light | Dark |
|---|---|---|
| bg | #eef0f3 | #0e1116 |
| surface | #ffffff | #161a21 |
| surface-2 | #f6f7f9 | #1b2028 |
| band | #eef1f5 | #1f252e |
| line | #e1e5ea | #272e38 |
| line-strong | #c8ced6 | #3a4350 |
| fg | #1b2230 | #e6e9ee |
| muted | #5d6878 | #9aa4b1 |
| faint | #8b95a3 | #6f7a88 |
| good / warn / bad | #1f8a57 / #c77712 / #cf3b3b | same |
| flag live / tax / hide / client / alt | #334155 / #0f9488 / #94a3b8 / #7357d6 / #e07a1f | #cbd5e1 / #2dd4bf / #64748b / #a18cff / #ff9a4a |

Harbor scheme:
| Token | Value |
|---|---|
| accent (petrol) | #0d6e7a, text on it #ffffff |
| accent text | #0b5f69 light / #62c7d4 dark |
| accent2 (amber) | #f0a020, text on it #241700 |
| accent2 text | #8f5c00 light / #f5bf5c dark |

Two-tone backdrop: a 135deg gradient from 16% amber over bg, to plain bg in the middle, to 16% petrol over bg. The rail and job header are 72% surface with a 6px blur so the backdrop shows through. Quote and chat panels stay solid.

## Motion rules
Ease for everything: cubic-bezier(.2,.7,.2,1). Respect reduced motion: when it's on, everything is instant.
| What | Motion | Time |
|---|---|---|
| View change (Home, Job, Shop) | slide 28px + fade, direction follows forward or back | 280ms |
| Switch job from the dropdown | name and quote fade up 8px | 300ms |
| Tabs and the phone Chat/Quote bar | underline slides to the active tab, content fades up 6px | 280ms / 240ms |
| On/off pickers (tier, mode, etc.) | highlight slides between options | 280ms |
| Dropdowns, Shop menu, Look panel | grow in from 97% + fade, shrink out | 180ms in / 150ms out |
| Line inspector | desktop: slide 28px from the right while the grid column eases open or closed. Phone: sheet slides up or down, backdrop fades | 220ms in / 200ms out |
| Flag switch | only the knob slides and the color fades. Never redraw the panel | 220ms |
| Totals | count up or down to the new number | 360ms |
| Card hover | lift 4px, shadow, top stripe sweep, Open slides in | 280ms |
| Accordions (crew, transcripts, add forms, save bars) | height eases open | 300ms |
| New chat message / reply | rises 10px, reply follows 220ms later | 300ms |
| Line added from chat | drops in with a brief petrol tint | 550ms |
| Exclusion uncheck | strike line draws across, then the row folds away | 280ms + 320ms |
| Toast | slides up from the bottom, slides back down | 260ms / 200ms |
| Button press | scales to 96% | 120ms |

## Layering rules (bugs already hit in the mockup)
- Any header holding a dropdown needs its own raised z-index above the content panes. Blur and backdrop filters create new stacking contexts and will trap menus underneath.
- The rail sits above main content (its Shop menu was hidden behind the job screen).
- Popovers need a solid surface background and their own scroll (max-height about 60vh).
- On phone, the app shell must not scroll as a whole. Main needs min-height 0 so only the panes scroll.

## Where this lands in the code
- `src/components/Nav.tsx`, `navItems.tsx`, `MobileMenu.tsx`: the new rail and bottom bar (New, Jobs, Ask AI, Shop menu).
- `src/app/page.tsx` and `src/app/history/page.tsx`: become the Home job board.
- `src/components/Workspace.tsx`, `ChatPanel.tsx`, `EstimateSheet.tsx`: the 3-pane job screen, totals strip, grid and inspector. The per-line chip row moves into the inspector.
- `src/components/InspectionWorkspace.tsx`: becomes the Scout tab inside a job.
- `src/components/RateBookManager.tsx`, `CrewQuotes.tsx`, `UserManager.tsx`, `src/app/admin`, `src/app/ratebook`: Shop tabs.
- `src/components/FontScale.tsx` and `AiBrainToggle.tsx`: fold into Shop > Settings.
- `tailwind.config.ts` and `globals.css`: replace the dark gold industrial tokens with the tokens above.
- Note: the `honeydone-ui` skill (dark gold industrial look) no longer applies to Sawbuck. This spec wins for this app.

## Open items
1. Confirm what each flag really means (table above).
2. Push the latest PC code so the build starts from it.
3. Still to design in detail: the Finalize flow and the Scout capture screen.
