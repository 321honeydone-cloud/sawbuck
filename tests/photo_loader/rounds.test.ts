import { test } from "node:test";
import assert from "node:assert/strict";
import { datePhoto, easternDate } from "../../src/lib/photo_loader/dates";
import { dedupePhotos, groupRounds, matchRounds, pickDateFolder } from "../../src/lib/photo_loader/rounds";
import type { QuoteWindow } from "../../src/lib/photo_loader/types";
import { jpg, NOW, stalwartChildren, stalwartQuote } from "./fixtures";

const dated = (files: ReturnType<typeof jpg>[], now = NOW) => dedupePhotos(files.map((f) => datePhoto(f, { now })));

test("Stalwart live listing: two rounds (9/28 and 9/29), duplicates collapsed, BA_ skipped, 10/21 flagged", () => {
  const photos = dated(stalwartChildren);
  const skipped = photos.filter((p) => p.skipped);
  assert.ok(skipped.some((p) => p.file.name.startsWith("BA_")));
  assert.equal(skipped.filter((p) => p.skipReason?.startsWith("duplicate")).length, 6, "six re-uploads of the 9/28 photos");
  const rounds = groupRounds(photos);
  // 9/26 screenshot, 9/28 round, 9/29 round, and the low-confidence uploads (10/21 file + the no-name jpg) sit by upload time.
  const days = rounds.map((r) => easternDate(r.startedAt));
  assert.deepEqual(days, ["2026-09-26", "2026-09-28", "2026-09-29", "2026-09-30"]);
  const r929 = rounds[2];
  assert.equal(r929.photos.length, 6, "six PXL photos from 9/29, 5:42pm to 6:57pm Eastern, one round");
  assert.ok(r929.photos.every((p) => p.file.name.startsWith("PXL_20260929")));
  const r928 = rounds[1];
  assert.equal(r928.photos.length, 7, "six PXL from 9/28 plus the un-named jpg uploaded that afternoon");
  assert.equal(r928.confidence, "low", "the un-named jpg drags the round to LOW");
  const flagged = photos.filter((p) => p.flags.some((f) => f.kind === "future_date"));
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].file.name, "2026-10-21_platform-removal-new-sod.jpg");
});

test("Stalwart rounds against the real quote: 9/29 = After on the job, 9/26 = Before, 9/28 needs a pick (LOW)", () => {
  const rounds = groupRounds(dated(stalwartChildren));
  const m = matchRounds(rounds, [stalwartQuote], { now: NOW });
  const by = Object.fromEntries(m.map((r) => [easternDate(r.startedAt), r]));
  assert.equal(by["2026-09-26"].quoteId, stalwartQuote.id);
  assert.equal(by["2026-09-26"].role, "Before");
  assert.equal(by["2026-09-29"].quoteId, stalwartQuote.id);
  assert.equal(by["2026-09-29"].role, "After", "after approval, before job complete + 7 days, last round in the window");
  assert.equal(by["2026-09-29"].reason, "after_approval");
  assert.equal(by["2026-09-28"].quoteId, null);
  assert.match(by["2026-09-28"].needsYou!, /upload times/);
  assert.equal(by["2026-09-30"].quoteId, null, "the 10/21 file and friends only have upload times");
});

test("12 hour gap splits rounds", () => {
  const photos = dated([
    jpg("a", "PXL_20260910_120000000.jpg", "p", "2026-09-10T12:00:00Z", 1),
    jpg("b", "PXL_20260910_235000000.jpg", "p", "2026-09-10T23:50:00Z", 2),
    jpg("c", "PXL_20260911_120100000.jpg", "p", "2026-09-11T12:01:00Z", 3),
  ]);
  const rounds = groupRounds(photos);
  assert.equal(rounds.length, 2);
  assert.equal(rounds[0].photos.length, 2);
});

const q = (id: string, createdAt: string, extra: Partial<QuoteWindow> = {}): QuoteWindow => ({ id, label: id, createdAt, approvedAt: null, jobCompletedAt: null, ...extra });

test("homeowner: before round, approved quote, after round 10 days later stays on the same job", () => {
  const photos = dated([
    jpg("b1", "IMG_20260901_100000.jpg", "h", "2026-09-01T14:00:00Z", 1),
    jpg("b2", "IMG_20260901_100500.jpg", "h", "2026-09-01T14:05:00Z", 2),
    jpg("a1", "IMG_20260913_160000.jpg", "h", "2026-09-13T20:00:00Z", 3),
  ]);
  const quote = q("EST-1", "2026-09-02T15:00:00Z", { approvedAt: "2026-09-03T12:00:00Z", jobCompletedAt: "2026-09-12T20:00:00Z" });
  const m = matchRounds(groupRounds(photos), [quote], { now: NOW });
  assert.equal(m.length, 2);
  assert.equal(m[0].role, "Before");
  assert.equal(m[0].quoteId, "EST-1");
  assert.equal(m[1].role, "After");
  assert.equal(m[1].quoteId, "EST-1");
  assert.equal(m[1].reason, "after_approval");
});

test("after round does not start a new quote even when a later quote exists", () => {
  const photos = dated([jpg("a1", "IMG_20260913_160000.jpg", "h", "2026-09-13T20:00:00Z", 3)]);
  const done = q("EST-1", "2026-09-02T15:00:00Z", { approvedAt: "2026-09-03T12:00:00Z", jobCompletedAt: "2026-09-12T20:00:00Z" });
  const later = q("EST-2", "2026-09-15T15:00:00Z");
  const m = matchRounds(groupRounds(photos), [done, later], { now: NOW });
  assert.equal(m[0].quoteId, "EST-1");
  assert.equal(m[0].role, "After");
});

test("progress then after: earlier rounds in the job window are Progress", () => {
  const photos = dated([
    jpg("p1", "IMG_20260905_100000.jpg", "h", "2026-09-05T14:00:00Z", 1),
    jpg("a1", "IMG_20260910_100000.jpg", "h", "2026-09-10T14:00:00Z", 2),
  ]);
  const quote = q("EST-1", "2026-09-01T15:00:00Z", { approvedAt: "2026-09-03T12:00:00Z", jobCompletedAt: "2026-09-10T20:00:00Z" });
  const m = matchRounds(groupRounds(photos), [quote], { now: NOW });
  assert.deepEqual(m.map((r) => r.role), ["Progress", "After"]);
});

test("round goes to the first quote created on or after it within 14 days; two in the same week is a pick", () => {
  const photos = dated([jpg("b1", "IMG_20260901_100000.jpg", "h", "2026-09-01T14:00:00Z", 1)]);
  const a = q("EST-A", "2026-09-03T15:00:00Z");
  const b = q("EST-B", "2026-09-20T15:00:00Z");
  assert.equal(matchRounds(groupRounds(photos), [a, b], { now: NOW })[0].quoteId, "EST-A");
  const c = q("EST-C", "2026-09-05T15:00:00Z");
  const m = matchRounds(groupRounds(photos), [a, c], { now: NOW });
  assert.equal(m[0].quoteId, null);
  assert.match(m[0].needsYou!, /same week/);
  const far = q("EST-F", "2026-09-30T15:00:00Z");
  assert.match(matchRounds(groupRounds(photos), [far], { now: NOW })[0].needsYou!, /fit no quote window/);
});

test("photos after the quote went in but before approval are Before on that quote", () => {
  const photos = dated([jpg("b1", "IMG_20260929_203611.jpg", "h", "2026-09-30T00:36:42Z", 1)]);
  const peter = q("EST-P", "2026-09-29T16:43:32Z", { approvedAt: "2026-09-30T16:17:50Z" });
  const m = matchRounds(groupRounds(photos), [peter], { now: NOW });
  assert.equal(m[0].quoteId, "EST-P");
  assert.equal(m[0].role, "Before");
  assert.equal(m[0].reason, "before_between_created_and_approval");
});

test("manual assignment wins", () => {
  const photos = dated([jpg("s1", "01.jpg", "h", "2026-09-29T16:32:20Z", 1)]);
  const rounds = groupRounds(photos);
  const quote = q("EST-S", "2026-09-29T17:00:00Z");
  assert.equal(matchRounds(rounds, [quote], { now: NOW })[0].quoteId, null, "LOW confidence alone never attaches");
  const m = matchRounds(rounds, [quote], { now: NOW, assignments: { [rounds[0].key]: { quoteId: "EST-S", role: "Before" } } });
  assert.equal(m[0].quoteId, "EST-S");
  assert.equal(m[0].reason, "manual");
});

test("date folder pinning: each quote loads only its own folder", () => {
  const folders = [{ date: "2026-08-01" }, { date: "2026-09-01" }];
  assert.equal(pickDateFolder(folders, "2026-08-01T15:00:00Z")!.date, "2026-08-01");
  assert.equal(pickDateFolder(folders, "2026-09-03T15:00:00Z")!.date, "2026-09-01", "closest on or before, within 14 days");
  assert.equal(pickDateFolder(folders, "2026-09-25T15:00:00Z"), null, "24 days later is too far");
  assert.equal(pickDateFolder(folders, "2026-07-20T15:00:00Z"), null, "a folder after the quote date never matches");
  assert.equal(pickDateFolder(folders, "2026-09-02T02:00:00Z")!.date, "2026-09-01", "9/1 10pm Eastern is still 9/1");
});
