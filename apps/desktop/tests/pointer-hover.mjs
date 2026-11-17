import { test } from "node:test";
import assert from "node:assert/strict";
import { trackPointerHover } from "../src/pointerHover.ts";

class ElementStub {
  constructor({ button = false, disabled = false, card = null } = {}) {
    this.button = button;
    this.disabled = disabled;
    this.card = card;
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
    };
  }
  closest(selector) {
    return selector === "button:not(:disabled)"
      ? this.button && !this.disabled
        ? this
        : null
      : this.card;
  }
}
globalThis.Element = ElementStub;
function fixture() {
  const doc = new EventTarget();
  doc.defaultView = new EventTarget();
  const stop = trackPointerHover(doc);
  const fire = (type, target, pointerType = "mouse") => {
    const event = new Event(type);
    Object.defineProperties(event, {
      target: { value: target },
      pointerType: { value: pointerType },
      relatedTarget: { value: null },
    });
    doc.dispatchEvent(event);
  };
  return { doc, fire, stop };
}
const isHovered = (element) => element.classes.has("is-pointer-hovered");

test("card and its button stay highlighted through phantom exits and idle time", async () => {
  const f = fixture();
  const card = new ElementStub();
  const button = new ElementStub({ button: true, card });
  f.fire("pointerover", button);
  f.fire("pointerout", button);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(isHovered(button), true);
  assert.equal(isHovered(card), true);
  f.fire("pointermove", new ElementStub());
  assert.equal(isHovered(button), false);
  assert.equal(isHovered(card), false);
  f.stop();
});

test("one app-level listener handles new buttons after screen changes", () => {
  const f = fixture();
  const buttons = Array.from(
    { length: 6 },
    () => new ElementStub({ button: true }),
  );
  for (const button of buttons) {
    f.fire("pointerover", button);
    f.fire("pointerout", button);
    assert.equal(isHovered(button), true);
    for (const other of buttons.filter((value) => value !== button)) {
      assert.equal(isHovered(other), false);
    }
  }
  f.doc.defaultView.dispatchEvent(new Event("blur"));
  assert.ok(buttons.every((button) => !isHovered(button)));
  f.fire("pointerover", buttons[0]);
  f.stop();
  assert.equal(isHovered(buttons[0]), false);
  f.fire("pointermove", buttons[1]);
  assert.equal(isHovered(buttons[1]), false);
});

test("disabled buttons and touch do not acquire hover; cancellation clears it", () => {
  const f = fixture();
  const disabled = new ElementStub({ button: true, disabled: true });
  const enabled = new ElementStub({ button: true });
  f.fire("pointerover", disabled);
  assert.equal(isHovered(disabled), false);
  f.fire("pointerover", enabled, "touch");
  assert.equal(isHovered(enabled), false);
  f.fire("pointerover", enabled);
  f.fire("pointercancel", enabled);
  assert.equal(isHovered(enabled), false);
  f.stop();
});
