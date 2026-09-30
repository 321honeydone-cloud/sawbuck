import { test } from "node:test";
import assert from "node:assert/strict";
import { datePhoto, easternDate, parseExifTime, parseFilenameDate, sawbuckPhotoName, toEastern } from "../../src/lib/photo_loader/dates";
import { jpg, NOW, PETER_ID, STALWART_ID } from "./fixtures";

test("PXL filenames are UTC and convert to Eastern", () => {
  const d = parseFilenameDate("PXL_20260929_225623968.jpg")!;
  assert.equal(d.pattern, "PXL");
  assert.equal(new Date(d.ms).toISOString(), "2026-09-29T22:56:23.968Z");
  assert.equal(toEastern(d.ms).time, "18:56");
  assert.equal(easternDate(d.ms), "2026-09-29");
});

test("IMG filenames are local (Eastern) time", () => {
  const d = parseFilenameDate("IMG_20260929_203611.jpg")!;
  assert.equal(d.pattern, "IMG");
  assert.equal(new Date(d.ms).toISOString(), "2026-09-30T00:36:11.000Z", "8:36pm EDT is 00:36 UTC next day");
  const p = datePhoto(jpg("x", "IMG_20260929_203611.jpg", PETER_ID, "2026-09-30T00:36:42.534Z", 1), { now: NOW });
  assert.equal(p.source, "filename");
  assert.equal(p.confidence, "medium");
  assert.equal(easternDate(p.takenAt!), "2026-09-29");
});

test("YYYY-MM-DD_ prefix is a date only, and a future date is thrown out and flagged", () => {
  const d = parseFilenameDate("2026-10-21_platform-removal-new-sod.jpg")!;
  assert.equal(d.dateOnly, true);
  const p = datePhoto(jpg("f", "2026-10-21_platform-removal-new-sod.jpg", STALWART_ID, "2026-09-30T19:05:25.493Z", 1), { now: NOW });
  assert.ok(p.flags.some((f) => f.kind === "future_date"));
  // Falls back to upload time at LOW confidence, so it never silently lands in a round as a high-confidence date.
  assert.equal(p.source, "upload");
  assert.equal(p.confidence, "low");
});

test("EXIF wins over filename; disagreement over a day is flagged", () => {
  assert.equal(new Date(parseExifTime("2026:09:29 18:56:23")!).toISOString(), "2026-09-29T22:56:23.000Z");
  const p = datePhoto(jpg("e", "PXL_20260901_120000000.jpg", STALWART_ID, "2026-09-29T22:58:17.083Z", 1, "2026:09:29 18:56:23"), { now: NOW });
  assert.equal(p.source, "exif");
  assert.equal(p.confidence, "high");
  assert.ok(p.flags.some((f) => f.kind === "exif_filename_disagree"));
});

test("no EXIF and no filename date: upload time, LOW confidence", () => {
  const p = datePhoto(jpg("s", "01.jpg", "sarah", "2026-09-29T16:32:20.994Z", 1), { now: NOW });
  assert.equal(p.source, "upload");
  assert.equal(p.confidence, "low");
  assert.ok(p.flags.some((f) => f.kind === "low_confidence"));
});

test("BA_ composites and Small copies are skipped, not dated", () => {
  assert.equal(datePhoto(jpg("b", "BA_wood-platform-removal-new-sod.jpg", STALWART_ID, "2026-09-30T19:05:26.879Z", 1), { now: NOW }).skipped, true);
  assert.equal(datePhoto(jpg("b", "PXL_20260929_225623968.jpg", "small", "2026-09-30T19:05:26.879Z", 1), { now: NOW, parentName: "Small" }).skipped, true);
});

test("a date folder pins the date at high confidence", () => {
  const p = datePhoto(jpg("d", "01.jpg", "df", "2026-09-29T16:32:20.994Z", 1), { now: NOW, folderDate: "2026-09-20" });
  assert.equal(p.source, "date_folder");
  assert.equal(p.confidence, "high");
  assert.equal(easternDate(p.takenAt!), "2026-09-20");
});

test("SawBUCK's own filenames carry the Eastern date and time", () => {
  assert.equal(sawbuckPhotoName("2026-09-29T22:56:23.968Z", 3), "2026-09-29_1856_03.jpg");
  assert.equal(parseFilenameDate("2026-09-29_1856_03.jpg")!.pattern, "SAWBUCK");
});
