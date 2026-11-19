import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
export function AssistantPanel({
  title,
  preference,
  actions,
  children,
  initiallyCollapsed = false,
  openOnMount = false,
}: {
  title: string;
  preference: string;
  actions?: (el: HTMLDivElement | null) => void;
  children: ReactNode;
  initiallyCollapsed?: boolean;
  openOnMount?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(
    () =>
      !openOnMount &&
      (localStorage.getItem(preference + ".collapsed") ??
        String(initiallyCollapsed)) === "true",
  );
  const [panelWidth, setPanelWidth] = useState(
    () => Number(localStorage.getItem(preference + ".width")) || 350,
  );
  function resizePanel(width: number, handle: HTMLElement) {
    const main = handle.closest(".app")?.querySelector("main");
    const limit = Math.max(
      200,
      window.innerWidth - (main?.getBoundingClientRect().left ?? 0) - 320,
    );
    const next = Math.round(Math.min(limit, Math.max(200, width)));
    setPanelWidth(next);
    localStorage.setItem(preference + ".width", String(next));
  }
  return createPortal(
    <div
      id="dish-assistant-panel"
      data-collapsed={collapsed}
      style={{ width: collapsed ? 40 : panelWidth }}
    >
      {!collapsed && (
        <div
          className="dish-chat-divider"
          role="separator"
          tabIndex={0}
          aria-label={`Resize ${title.toLowerCase()}`}
          aria-orientation="vertical"
          aria-valuenow={panelWidth}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              resizePanel(window.innerWidth - e.clientX, e.currentTarget);
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              resizePanel(
                (e.currentTarget.parentElement?.clientWidth ?? panelWidth) +
                  (e.key === "ArrowLeft" ? 16 : -16),
                e.currentTarget,
              );
            }
          }}
        />
      )}
      <div className="dish-chat-header">
        <button
          className="dish-chat-toggle"
          type="button"
          aria-expanded={!collapsed}
          aria-controls="dish-chat-body"
          onClick={() => {
            setCollapsed(!collapsed);
            localStorage.setItem(preference + ".collapsed", String(!collapsed));
          }}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d={collapsed ? "m10 3-5 5 5 5" : "m6 3 5 5-5 5"} />
          </svg>
          <span>{title}</span>
        </button>
        <div ref={actions} hidden={collapsed} />
      </div>
      <div id="dish-chat-body" hidden={collapsed}>
        {children}
      </div>
    </div>,
    document.querySelector(".app")!,
  );
}
