export type Appearance = "system" | "dark" | "light";
const storageKey = "todu-fit-appearance";

export function readAppearance(): Appearance {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // The app can still change appearance if storage is unavailable.
  }
  return "system";
}

export function saveAppearance(value: Appearance) {
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    // Retain the selection for this session.
  }
}

export function applyAppearance(value: Appearance) {
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const update = () => {
    document.documentElement.dataset.theme =
      value === "system" ? (system.matches ? "dark" : "light") : value;
  };
  update();
  system.addEventListener("change", update);
  return () => system.removeEventListener("change", update);
}
