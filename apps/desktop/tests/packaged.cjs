// Real packaged UI -> sandboxed IPC -> isolated shared daemon; never user stores.
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fixture } = require("./daemon-fixture.cjs");
async function main() {
  const base = path.resolve(__dirname, "..");
  const executablePath =
    process.env.TODU_PACKAGED_EXECUTABLE ||
    (process.platform === "darwin"
      ? path.join(
          base,
          "out",
          process.arch === "arm64" ? "mac-arm64" : "mac",
          "Todu Fit Proof.app/Contents/MacOS/Todu Fit Proof",
        )
      : path.join(base, "out/win-unpacked/Todu Fit Proof.exe"));
  const f = await fixture();
  const results = path.join(base, "test-results");
  fs.mkdirSync(results, { recursive: true });
  let app;
  let page;
  const errors = [];
  const launch = async () => {
    app = await electron.launch({
      executablePath,
      env: {
        ...process.env,
        TODU_FIT_PROOF_DATA: path.join(f.root, "desktop"),
        FIT_DAEMON_ENDPOINT: f.endpoint,
      },
      timeout: 30000,
    });
    page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
  };
  const nav = async (name) =>
    page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
  const waitText = async (text) =>
    page.getByText(text, { exact: true }).first().waitFor();
  const request = async (op) =>
    page.evaluate(async (op) => {
      const r = await window.fit.request(op);
      if (!r.ok) throw Error(r.error);
      return r.value.data;
    }, op);
  try {
    await launch();
    await page.getByRole("button", { name: "New dish", exact: true }).click();
    await page
      .getByLabel("Dish name", { exact: true })
      .fill("Packaged lentil soup");
    await page
      .getByRole("button", { name: "Add ingredient", exact: true })
      .click();
    await page.getByLabel("Ingredient", { exact: true }).fill("Lentils");
    await page.getByLabel("Quantity", { exact: true }).fill("2");
    await page.getByLabel("Unit", { exact: true }).fill("cup");
    await page
      .getByRole("button", { name: "Add nutrient", exact: true })
      .click();
    await page.getByLabel("Amount", { exact: true }).fill("300");
    await page
      .getByLabel("Instructions (Markdown)", { exact: true })
      .fill("Simmer **gently**.");
    await page.getByRole("button", { name: "Save dish", exact: true }).click();
    await page
      .getByRole("heading", { name: "Packaged lentil soup", exact: true })
      .waitFor();
    const dish = (await request({ type: "dishes_list" }))[0];
    assert.equal(dish.ingredients[0].name, "Lentils");
    assert.match(await f.cli("dish", "show", dish.id), /Packaged lentil soup/);
    assert.equal(await page.evaluate(() => typeof window.require), "undefined");
    assert.deepEqual(await page.evaluate(() => Object.keys(window.fit)), [
      "request",
    ]);
    const invalid = await page.evaluate(() =>
      window.fit.request({ type: "identity_create", replace: true }),
    );
    assert.equal(invalid.ok, false);
    await nav("Meal plans");
    await page
      .getByRole("button", { name: "New meal plan", exact: true })
      .click();
    await page.getByLabel("Title", { exact: true }).fill("Soup night");
    await page
      .getByRole("button", { name: "Add Packaged lentil soup", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save meal plan", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Soup night", exact: true })
      .waitFor();
    // Route state must not leak a plan editor into the food-log editor.
    await page.getByRole("button", { name: "Edit plan", exact: true }).click();
    await nav("Food log");
    await page
      .getByRole("heading", { name: "Food log", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Log a meal", exact: true }).click();
    await page.getByLabel("Use a planned meal").selectOption({
      label: (
        await page
          .getByLabel("Use a planned meal")
          .locator("option")
          .allTextContents()
      ).find((s) => s.includes("Soup night")),
    });
    await page.getByLabel("Packaged lentil soup servings").fill("0.5");
    await page
      .getByRole("button", { name: "Save meal log", exact: true })
      .click();
    await waitText("Packaged lentil soup (0.5 servings)");
    await waitText("calories (kcal): 150");
    const dates = await request({
      type: "meals_history",
      from: "2000-01-01",
      to: "2099-12-31",
    });
    assert.equal(dates[0].nutrients.calories, 150);
    await nav("Shopping");
    await page.getByRole("listitem").filter({ hasText: "Lentils" }).waitFor();
    await page.getByLabel("Item name").fill("Paper towels");
    await page.getByLabel("Quantity", { exact: true }).fill("a few");
    await page.getByLabel("Unit", { exact: true }).fill("rolls");
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await page.getByText("Paper towels", { exact: false }).first().waitFor();
    const manual = page
      .getByRole("listitem")
      .filter({ hasText: "Paper towels" });
    await manual.getByRole("checkbox").click();
    await page
      .getByRole("button", { name: "Show checked (1)", exact: true })
      .waitFor();
    await page.getByRole("button", { name: /Show checked/ }).click();
    await manual.getByRole("checkbox").waitFor();
    assert.equal(await manual.getByRole("checkbox").isChecked(), true);
    await manual
      .getByRole("button", { name: "Edit item", exact: true })
      .click();
    await page.getByLabel("Item name").fill("Kitchen towels");
    await page.getByRole("button", { name: "Save item", exact: true }).click();
    await page.getByText("Kitchen towels", { exact: false }).first().waitFor();
    await nav("Settings");
    await page.getByLabel("Display unit").selectOption("ml");
    await page
      .getByRole("button", { name: "Save water settings", exact: true })
      .click();
    await page.waitForFunction(async () => {
      const r = await window.fit.request({ type: "water_settings_get" });
      return r.ok && r.value.data.preferred_unit === "ml";
    });
    await nav("Water");
    await page.getByLabel("Water amount").fill("250");
    await page.getByRole("button", { name: "Add water", exact: true }).click();
    await page
      .getByRole("heading", { name: "250 mL today", exact: true })
      .waitFor();
    await nav("Settings");
    await page.getByLabel("Daily goal (mL)").fill("1800");
    await page
      .getByRole("button", { name: "Save water settings", exact: true })
      .click();
    await page.waitForFunction(async () => {
      const r = await window.fit.request({ type: "water_settings_get" });
      return r.ok && r.value.data.daily_goal_ml === 1800;
    });
    await nav("Dishes");
    await page.screenshot({ path: path.join(results, "dishes.png") });
    await app.close();
    app = undefined;
    await f.cli("dish", "create", "CLI while desktop closed");
    await launch();
    await page
      .getByRole("heading", { name: "CLI while desktop closed", exact: true })
      .waitFor();
    await page
      .getByRole("heading", { name: "Packaged lentil soup", exact: true })
      .waitFor();
    await nav("Meal plans");
    await page
      .getByRole("heading", { name: "Soup night", exact: true })
      .waitFor();
    await page.screenshot({ path: path.join(results, "plans.png") });
    await nav("Food log");
    await waitText("Packaged lentil soup (0.5 servings)");
    await page.screenshot({ path: path.join(results, "food-log.png") });
    await nav("Water");
    await page
      .getByRole("heading", { name: "250 mL today", exact: true })
      .waitFor();
    await page.screenshot({ path: path.join(results, "water.png") });
    assert.deepEqual(errors, []);
    const versions = await app.evaluate(() => process.versions);
    await app.close();
    app = undefined;
    const evidence = {
      passed: true,
      platform: process.platform,
      arch: process.arch,
      executablePath,
      dishId: dish.id,
      versions,
      checkedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(results, "packaged.json"),
      JSON.stringify(evidence, null, 2),
    );
    console.log(JSON.stringify(evidence, null, 2));
  } catch (e) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(results, "failure.png") });
      console.error(await page.locator("body").innerText());
    }
    throw e;
  } finally {
    if (app) await app.close();
    await f.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
