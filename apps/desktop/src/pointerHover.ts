// Window sharing can emit phantom pointerout events with unrelated coordinates.
// Use actual hit targets to keep hover stable until the pointer reaches another
// element, input is cancelled, or the app loses focus.
export function trackPointerHover(document: Document) {
  let hovered: HTMLElement[] = [];
  const setHovered = (next: HTMLElement[]) => {
    for (const element of hovered) {
      if (!next.includes(element))
        element.classList.remove("is-pointer-hovered");
    }
    for (const element of next) {
      if (!hovered.includes(element))
        element.classList.add("is-pointer-hovered");
    }
    hovered = next;
  };
  const update = (event: Event) => {
    if ((event as PointerEvent).pointerType === "touch") return;
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLElement>("button:not(:disabled)");
    const card = target?.closest<HTMLElement>(".cards [data-dish-id]");
    setHovered(
      [button, card].filter((element): element is HTMLElement => !!element),
    );
  };
  const clear = () => setHovered([]);
  document.addEventListener("pointerover", update);
  document.addEventListener("pointermove", update);
  document.addEventListener("pointercancel", clear);
  document.defaultView?.addEventListener("blur", clear);
  return () => {
    clear();
    document.removeEventListener("pointerover", update);
    document.removeEventListener("pointermove", update);
    document.removeEventListener("pointercancel", clear);
    document.defaultView?.removeEventListener("blur", clear);
  };
}
