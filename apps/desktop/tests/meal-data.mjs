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

test("a deleted dish does not hide its plan or other dishes in the week", async () => {
  const plans = [{ dish_ids: ["deleted", "remaining"] }];
  const result = await loadMealWeek(
    async (op) => {
      if (op.type === "plans_list") return plans;
      if (op.identifier === "deleted")
        throw new Error("Dish not found: deleted");
      return { id: "remaining" };
    },
    false,
    true,
    "2026-11-08",
    "2026-11-14",
  );
  assert.deepEqual(result.plans, plans);
  assert.deepEqual(result.dishes, [{ id: "remaining" }]);
});

import { parseReply, comparison } from "../src/planning.ts";
test("planning uses scoped IDs, rejects invented dishes and compares daily servings", () => {
  const data = {
    dishes: [
      {
        id: "dish",
        name: "Soup",
        nutrients: [{ name: "Protein", unit: "g", amount: 12 }],
      },
    ],
    people: { person: { name: "Sam", targets: {} } },
    existing: [],
  };
  const meal = {
    date: "2026-11-10",
    meal_type: "lunch",
    title: "Soup",
    dish_ids: ["d1"],
    portions: { p1: { d1: 1.5 } },
  };
  const parse = (m) =>
    parseReply(
      JSON.stringify({ message: "Lunch", meals: [m] }),
      data,
      "2026-11-08",
      "2026-11-14",
    ).meals;
  const meals = parse(meal);
  assert.deepEqual(meals[0].portions, { person: { dish: 1.5 } });
  assert.deepEqual(comparison(data, meals, meal.date, "person", "protein_g"), {
    total: 18,
    partial: false,
  });
  assert.equal(
    comparison(data, meals, meal.date, "person", "fiber_g").partial,
    true,
  );
  data.existing.push({
    ...meals[0],
    portions: { person: { servings: { dish: 0.5 } } },
  });
  assert.equal(
    comparison(data, meals, meal.date, "person", "protein_g").total,
    24,
  );
  data.existing[0].portions = {};
  assert.equal(
    comparison(data, meals, meal.date, "person", "protein_g").partial,
    true,
  );
  for (const change of [
    { dish_ids: ["unknown"] },
    { date: "2026-11-18" },
    { portions: { p1: { d1: 0 } } },
    { portions: { p2: { d1: 1 } } },
  ]) {
    assert.throws(() => parse({ ...meal, ...change }));
  }
});
