import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPhotosForQuote } from "../../src/lib/photo_loader/loader";
import { easternDate } from "../../src/lib/photo_loader/dates";
import type { DriveFile, QuoteWindow } from "../../src/lib/photo_loader/types";
import { fakeDrive, folder, jpg, liveTree, NOW, peterQuote, RED_ID, ROOT, STALWART_ID, stalwartQuote } from "./fixtures";

test("Test 1: Real Estate Direct / 8426 Stalwart Cir (live listing)", async () => {
  const drive = fakeDrive(liveTree);
  const res = await loadPhotosForQuote(drive, {
    quoteId: stalwartQuote.id,
    clientName: "Real Estate Direct",
    propertyAddress: "8426 Stalwart Circle, Melbourne, Florida, 32940",
    quotes: [stalwartQuote],
    isPm: true,
    propertyCount: 1,
    now: NOW,
    rootId: ROOT,
  });
  assert.equal(res.ok, true, res.error ?? "");
  assert.equal(res.folder?.layout, "pm");
  assert.equal(res.folder?.propertyFolder?.id, STALWART_ID, "address folder found through Circle vs Cir");
  assert.equal(res.folder?.dateFolders.length, 0);
  assert.ok(res.skipped.some((s) => s.name.startsWith("BA_")), "BA_ composite skipped");
  const mine = res.rounds.filter((r) => r.quoteId === stalwartQuote.id);
  const days = mine.map((r) => `${easternDate(r.startedAt)}:${r.role}`).sort();
  assert.deepEqual(days, ["2026-09-26:Before", "2026-09-29:After"]);
  const r929 = mine.find((r) => easternDate(r.startedAt) === "2026-09-29")!;
  assert.equal(r929.photos.length, 6);
  assert.ok(r929.photos.every((p) => p.file.name.startsWith("PXL_20260929")));
  const sort = res.needsYou.find((c) => c.kind === "sort_photos");
  assert.ok(sort && sort.kind === "sort_photos", "Sort photos card offered for loose PM photos");
  assert.equal(sort.propertyFolderId, STALWART_ID);
  const s929 = sort.rounds.find((x) => easternDate(x.round.startedAt) === "2026-09-29")!;
  assert.equal(s929.suggestedQuoteId, stalwartQuote.id);
  assert.equal(s929.suggestedDate, "2026-09-26", "date folder = first round for that quote");
  const flagged = res.needsYou.find((c) => c.kind === "flagged");
  assert.ok(flagged && flagged.kind === "flagged");
  assert.match(flagged.detail, /2026-10-21_platform-removal-new-sod\.jpg/);
  assert.ok(res.needsYou.some((c) => c.kind === "pick_quote"), "LOW-confidence 9/28 round needs a pick");
});

test("Test 2: Sarah Rohling flat folder, no dates anywhere: LOW and into Needs you", async () => {
  const drive = fakeDrive(liveTree);
  const sarah: QuoteWindow = { id: "EST-S", label: "Sarah (EST-S)", createdAt: "2026-09-29T17:00:00Z", approvedAt: null, jobCompletedAt: null };
  const res = await loadPhotosForQuote(drive, { quoteId: "EST-S", clientName: "Sarah Rohling", propertyAddress: "808 Topaz Dr", quotes: [sarah], propertyCount: 1, now: NOW, rootId: ROOT });
  assert.equal(res.folder?.layout, "flat");
  assert.equal(res.rounds.length, 1);
  assert.equal(res.rounds[0].photos.length, 3);
  assert.equal(res.rounds[0].confidence, "low");
  assert.equal(res.rounds[0].quoteId, null);
  const pick = res.needsYou.find((c) => c.kind === "pick_quote");
  assert.ok(pick && pick.kind === "pick_quote");
  assert.deepEqual(pick.choices.map((c) => c.quoteId), ["EST-S"]);
});

test("Test 2b: Sarah with EXIF present dates from EXIF and attaches", async () => {
  const withExif = liveTree["12oBt3JQEb25W_7UZOzYVIOKhxlCj53kb"].map((f) => ({ ...f, exifTime: "2026:09:29 11:1" + f.name[1] + ":00" }));
  const drive = fakeDrive({ ...liveTree, ["12oBt3JQEb25W_7UZOzYVIOKhxlCj53kb"]: withExif });
  const sarah: QuoteWindow = { id: "EST-S", label: "Sarah (EST-S)", createdAt: "2026-09-29T17:00:00Z", approvedAt: null, jobCompletedAt: null };
  const res = await loadPhotosForQuote(drive, { quoteId: "EST-S", clientName: "Sarah Rohling", propertyAddress: "808 Topaz Dr", quotes: [sarah], propertyCount: 1, now: NOW, rootId: ROOT });
  assert.equal(res.rounds[0].confidence, "high");
  assert.equal(res.rounds[0].quoteId, "EST-S");
  assert.equal(res.rounds[0].role, "Before");
});

test("Test 3: Peter Pappas IMG_ filename read as local time, Before on the open quote", async () => {
  const drive = fakeDrive(liveTree);
  const res = await loadPhotosForQuote(drive, { quoteId: peterQuote.id, clientName: "Peter Pappas", propertyAddress: "2306 Salew St", quotes: [peterQuote], propertyCount: 1, now: NOW, rootId: ROOT });
  assert.equal(res.folder?.layout, "flat");
  assert.equal(res.rounds.length, 1);
  const r = res.rounds[0];
  assert.equal(r.photos[0].source, "filename");
  assert.equal(r.photos[0].takenAt, "2026-09-30T00:36:11.000Z", "8:36pm Eastern");
  assert.equal(easternDate(r.startedAt), "2026-09-29");
  assert.equal(r.quoteId, peterQuote.id);
  assert.equal(r.role, "Before");
  assert.equal(r.confidence, "medium");
});

test("Test 4: fake PM property with two date folders a month apart, two quotes, each loads its own", async () => {
  const PM = "pm", ADDR = "addr", AUG = "aug", SEP = "sep";
  const tree: Record<string, DriveFile[]> = {
    [ROOT]: [folder(PM, "Acme Property Mgmt", ROOT)],
    [PM]: [folder(ADDR, "12 Oak Ln", PM)],
    [ADDR]: [folder(AUG, "2026-08-01", ADDR), folder(SEP, "2026-09-01", ADDR)],
    [AUG]: [jpg("a1", "PXL_20260801_150000000.jpg", AUG, "2026-08-01T15:10:00Z", 1), jpg("a2", "PXL_20260801_150500000.jpg", AUG, "2026-08-01T15:10:00Z", 2)],
    [SEP]: [jpg("s1", "PXL_20260901_150000000.jpg", SEP, "2026-09-01T15:10:00Z", 3)],
  };
  const qa: QuoteWindow = { id: "EST-AUG", label: "Aug job", createdAt: "2026-08-02T14:00:00Z", approvedAt: "2026-08-03T14:00:00Z", jobCompletedAt: "2026-08-10T14:00:00Z" };
  const qs: QuoteWindow = { id: "EST-SEP", label: "Sep job", createdAt: "2026-09-02T14:00:00Z", approvedAt: null, jobCompletedAt: null };
  for (const [me, other] of [[qa, qs], [qs, qa]] as const) {
    const res = await loadPhotosForQuote(fakeDrive(tree), { quoteId: me.id, clientName: "Acme Property Mgmt", propertyAddress: "12 Oak Lane", quotes: [me, other], isPm: true, propertyCount: 3, now: NOW, rootId: ROOT });
    assert.equal(res.folder?.layout, "pm");
    assert.equal(res.folder?.dateFolders.length, 2);
    assert.equal(res.folder?.chosenDateFolder?.date, me === qa ? "2026-08-01" : "2026-09-01");
    const mine = res.rounds.filter((r) => r.quoteId === me.id);
    assert.equal(mine.length, 1, `${me.id} gets exactly one round`);
    assert.equal(mine[0].dateFolder?.date, me === qa ? "2026-08-01" : "2026-09-01");
    assert.equal(mine[0].reason, "date_folder");
    assert.equal(mine[0].role, "Before");
    assert.equal(res.rounds.filter((r) => r.quoteId === other.id).length, 1);
    assert.equal(res.needsYou.length, 0, "clean: no cards");
  }
});

test("Test 5: fake homeowner, before round, approved quote, after round 10 days later", async () => {
  const H = "home";
  const tree: Record<string, DriveFile[]> = {
    [ROOT]: [folder(H, "Jane Doe", ROOT)],
    [H]: [
      jpg("b1", "IMG_20260901_100000.jpg", H, "2026-09-01T14:00:00Z", 1),
      jpg("b2", "IMG_20260901_100500.jpg", H, "2026-09-01T14:05:00Z", 2),
      jpg("a1", "IMG_20260913_160000.jpg", H, "2026-09-13T20:00:00Z", 3),
      jpg("a2", "IMG_20260913_161000.jpg", H, "2026-09-13T20:10:00Z", 4),
    ],
  };
  const quote: QuoteWindow = { id: "EST-J", label: "Jane fence", createdAt: "2026-09-02T15:00:00Z", approvedAt: "2026-09-03T12:00:00Z", jobCompletedAt: "2026-09-12T20:00:00Z" };
  const res = await loadPhotosForQuote(fakeDrive(tree), { quoteId: "EST-J", clientName: "Jane Doe", propertyAddress: "", quotes: [quote], propertyCount: 1, now: NOW, rootId: ROOT });
  assert.equal(res.rounds.length, 2);
  assert.deepEqual(res.rounds.map((r) => [r.quoteId, r.role]), [["EST-J", "Before"], ["EST-J", "After"]]);
  assert.equal(res.needsYou.length, 0);
});

test("Test 6 (folder side): 8426 Stalwart Circle matches, 8428 Stalwart Cir does not", async () => {
  const tree = { ...liveTree, [RED_ID]: [folder("other", "8428 Stalwart Cir", RED_ID)] };
  const res = await loadPhotosForQuote(fakeDrive(tree), { quoteId: "EST-X", clientName: "Real Estate Direct", propertyAddress: "8426 Stalwart Circle", quotes: [stalwartQuote], isPm: true, now: NOW, rootId: ROOT });
  assert.equal(res.folder?.propertyFolder, null);
  const c = res.needsYou[0];
  assert.equal(c.kind, "no_property_folder");
  assert.ok(c.kind === "no_property_folder" && c.candidates.includes("8428 Stalwart Cir"));
});

test("no client folder: Needs you, nothing created", async () => {
  const drive = fakeDrive(liveTree);
  const res = await loadPhotosForQuote(drive, { quoteId: "EST-N", clientName: "Real Estate Direkt", propertyAddress: "8426 Stalwart Cir", quotes: [], now: NOW, rootId: ROOT });
  assert.equal(res.needsYou[0].kind, "no_client_folder");
  assert.deepEqual(drive.calls, [ROOT], "only the root was read");
});

test("homeowner flat folder with more than one property in Jobber: Needs you", async () => {
  const res = await loadPhotosForQuote(fakeDrive(liveTree), { quoteId: peterQuote.id, clientName: "Peter Pappas", propertyAddress: "2306 Salew St", quotes: [peterQuote], propertyCount: 2, now: NOW, rootId: ROOT });
  assert.ok(res.needsYou.some((c) => c.kind === "flat_folder_many_properties"));
  assert.equal(res.rounds[0].quoteId, null);
});
