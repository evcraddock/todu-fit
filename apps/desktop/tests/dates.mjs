import test from "node:test";
import assert from "node:assert/strict";
import { today } from "../src/dates.ts";

test("shared timezone selects the calendar day across midnight and year boundaries", () => {
  const instant = new Date("2027-01-01T01:30:00Z");
  assert.equal(today("America/Chicago", instant), "2026-12-31");
  assert.equal(today("UTC", instant), "2027-01-01");
  assert.equal(today("Pacific/Kiritimati", instant), "2027-01-01");
});

test("shared timezone follows daylight saving transitions", () => {
  assert.equal(
    today("America/Chicago", new Date("2026-03-09T05:30:00Z")),
    "2026-03-09",
  );
  assert.equal(
    today("America/Chicago", new Date("2026-11-02T05:30:00Z")),
    "2026-11-01",
  );
});
