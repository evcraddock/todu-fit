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

test("large weeks do not open a connection for every dish at once", async () => {
  let active = 0;
  const ids = Array.from({ length: 32 }, (_, i) => String(i));
  const result = await loadReferencedDishes(async ({ identifier }) => {
    assert.equal(++active, 1);
    await Promise.resolve();
    active--;
    return { id: identifier };
  }, ids);
  assert.deepEqual(
    result.map((dish) => dish.id),
    ids,
  );
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

import {
  daySlots,
  dayWrites,
  tallyInputs,
  savedProposal,
} from "../src/guidedPlanning.ts";
test("a guided revision replaces only its accepted meal in the projected tally", () => {
  const dish = {
    id: "soup",
    name: "Soup",
    nutrients: [{ name: "protein", unit: "g", amount: 10 }],
  };
  const plan = {
    id: "saved",
    date: "2026-11-08",
    title: "Soup",
    meal_type: "dinner",
    dish_ids: ["soup"],
    portions: { me: { name: "Member", servings: { soup: 1 } } },
  };
  const data = {
    existing: [{ ...plan, date: "2026-11-07", id: "sat" }, plan],
    dishes: [dish],
    people: {},
    fingerprint: "test",
  };
  const slots = daySlots(data, plan.date);
  assert.deepEqual(
    slots.map((s) => s.key),
    ["lunch", "saved", "breakfast", "snack"],
  );
  const accepted = { saved: { kind: "keep" } },
    revised = {
      saved: {
        kind: "proposal",
        meal: { ...savedProposal(plan), portions: { me: { soup: 2 } } },
        leftovers: false,
      },
    };
  const total = (choices) => {
    const { data: d, meals } = tallyInputs(data, choices);
    return comparison(d, meals, plan.date, "me", "protein_g").total;
  };
  assert.equal(total(accepted), 10);
  assert.equal(total(revised), 20);
  assert.deepEqual(dayWrites(slots, accepted), []);
  assert.equal(dayWrites(slots, revised)[0].replaces, plan.id);
});

test("food log draft keeps existing dishes through missing-dish creation and portion revisions", async () => {
  const { applyLogReply, selectLogDish } = await import("../src/foodLogging.ts");
  const soup = { id: "soup", name: "Tomato Soup" };
  const search = async () => [soup, { id: "other", name: "Turkey Sandwich" }];
  const { draft } = await applyLogReply(JSON.stringify({
    message: "Review your lunch.", meal: "lunch",
    changes: [{ name: "Tomato soup", servings: 1.5 }, { name: "New toast", servings: 2 }]
  }), { date: "2026-11-18", meal: "", items: [] }, search);
  assert.equal(draft.items[0].dish.id, "soup");
  assert.deepEqual(draft.items[1].matches, []);
  const completed = selectLogDish(draft, 1, {id: "toast", name: "Pepper Toast"});
  const revised = await applyLogReply(JSON.stringify({
    message: "Updated.", changes: [{ name: "Pepper Toast", servings: 0.5 }]
  }), completed, () => { throw Error("Selected dishes should not be searched again"); });
  assert.deepEqual(revised.draft.items.map(i => [i.dish.id, i.servings]), [["soup",1.5], ["toast",0.5]]);
});

test("food log suggests only the selected slot and keeps each person's planned servings", async () => {
  const { plannedLogs } = await import("../src/foodLogging.ts");
  const dishes = [{ id: "soup", name: "Soup" }, { id: "toast", name: "Toast" }];
  const lunch = {
    id: "p1", title: "Soup lunch", date: "2026-11-18", meal_type: "lunch", dish_ids: ["soup", "toast"],
    portions: { a: {name: "Alex", servings: {soup: 1}}, b: {name: "Sam", servings: {soup: 1.5, toast: 2}} }
  };
  const options = plannedLogs([lunch, {...lunch, date:"2026-11-17"}, {...lunch,meal_type:"dinner"}], dishes, lunch.date, "lunch");
  assert.deepEqual(options.map(p => [p.title, p.items.map(i=>[i.name,i.servings])]), [
    ["Soup lunch · Alex", [["Soup",1]]], ["Soup lunch · Sam", [["Soup",1.5],["Toast",2]]]
  ]);
});
