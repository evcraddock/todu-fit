import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMealWeek, loadReferencedDishes } from "../src/mealData.ts";

test("meal plans fetch only the week and unique referenced dishes", async () => {
  const calls = [];
  const request = async (op) => {
    calls.push(op);
    if (op.type === "plans_list")
      return [{ dish_ids: ["a", "b"] }, { dish_ids: ["a"] }];
    if (op.type === "dish_get") return { id: op.identifier };
    throw new Error(`Unexpected request: ${op.type}`);
  };
  const result = await loadMealWeek(
    request,
    false,
    true,
    "2026-11-08",
    "2026-11-14",
  );
  assert.deepEqual(calls, [
    { type: "plans_list", from: "2026-11-08", to: "2026-11-14" },
    { type: "dish_get", identifier: "a" },
    { type: "dish_get", identifier: "b" },
  ]);
  assert.equal(result.dishes.length, 2);
  assert.deepEqual(result.history, []);
});

test("food log uses snapshots without fetching plans or dishes, even without a group", async () => {
  const calls = [];
  const history = [{ log: { dishes: [{ id: "historic" }] } }];
  const result = await loadMealWeek(
    async (op) => {
      calls.push(op);
      return history;
    },
    true,
    false,
    "2026-11-08",
    "2026-11-14",
  );
  assert.deepEqual(calls, [
    { type: "meals_history", from: "2026-11-08", to: "2026-11-14" },
  ]);
  assert.deepEqual(result, { history, plans: [], dishes: [] });
});

test("empty selections and plans without a group make no requests", async () => {
  const request = async () => {
    throw new Error("Unexpected request");
  };
  assert.deepEqual(await loadReferencedDishes(request, []), []);
  assert.deepEqual(
    await loadMealWeek(request, false, false, "2026-11-08", "2026-11-14"),
    { plans: [], history: [], dishes: [] },
  );
});

test("request failures are surfaced instead of showing incorrect totals", async () => {
  await assert.rejects(
    loadReferencedDishes(async () => {
      throw new Error("Offline");
    }, ["a"]),
    /Offline/,
  );
});
