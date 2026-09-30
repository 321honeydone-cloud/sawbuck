import { test } from "node:test";
import assert from "node:assert/strict";
import { addressesMatch, normalizeAddress, looksLikeAddress, streetLine } from "../../src/lib/photo_loader/address";

test("Stalwart: Circle and Cir match, a different house number does not", () => {
  assert.equal(addressesMatch("8426 Stalwart Circle", "8426 Stalwart Cir"), true);
  assert.equal(addressesMatch("8426 Stalwart Circle, Melbourne, Florida, 32940", "8426 Stalwart Cir"), false, "full address must go through streetLine first");
  assert.equal(addressesMatch(streetLine("8426 Stalwart Circle, Melbourne, Florida, 32940"), "8426 Stalwart Cir"), true);
  assert.equal(addressesMatch("8428 Stalwart Cir", "8426 Stalwart Circle"), false);
});

test("suffix, direction, punctuation and case normalize", () => {
  assert.equal(addressesMatch("2306 SALEW ST.", "2306 Salew Street"), true);
  assert.equal(addressesMatch("808 Topaz Dr", "808 Topaz Drive"), true);
  assert.equal(addressesMatch("100 N. Harbor City Blvd", "100 North Harbor City Boulevard"), true);
  assert.equal(addressesMatch("12 Oak Ln", "12 Oak Ave"), false);
  assert.equal(addressesMatch("12 Oak", "12 Oak Ln"), true, "missing suffix on one side is tolerated");
});

test("unit numbers must match when present", () => {
  assert.equal(addressesMatch("500 Ocean Ave Unit 2B", "500 Ocean Avenue #2B"), true);
  assert.equal(addressesMatch("500 Ocean Ave Unit 2B", "500 Ocean Ave Apt 3A"), false);
  assert.equal(addressesMatch("500 Ocean Ave Unit 2B", "500 Ocean Ave"), false);
  assert.equal(normalizeAddress("500 Ocean Ave Apt. 3A").unit, "3a");
});

test("looksLikeAddress spots address folders", () => {
  assert.equal(looksLikeAddress("8426 Stalwart Cir"), true);
  assert.equal(looksLikeAddress("Small"), false);
  assert.equal(looksLikeAddress("2026-09-29"), false);
});
