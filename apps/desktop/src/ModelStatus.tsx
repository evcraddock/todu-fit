import { useEffect, useState } from "react";

export const MODEL_CHANGED_EVENT = "fit-default-model-changed";

export function ModelStatus() {
  const [model, setModel] = useState<{ name: string; provider: string } | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    let version = 0;
    const refresh = async () => {
      const current = ++version;
      try {
        const result = await window.fit.assistant({ type: "settings" });
        if (!result.ok) return;
        const settings = result.value as {
          model: { provider: string; modelId: string } | null;
          providers: { id: string; name: string }[];
        };
        const selected = settings.model;
        if (!selected) {
          if (active && current === version) setModel(null);
          return;
        }
        const catalog = await window.fit.assistant({
          type: "models",
          provider: selected.provider,
        });
        const models = catalog.ok
          ? (catalog.value as { id: string; name: string }[])
          : [];
        if (active && current === version)
          setModel({
            name:
              models.find((m) => m.id === selected.modelId)?.name ??
              selected.modelId,
            provider:
              settings.providers.find((p) => p.id === selected.provider)
                ?.name ?? selected.provider,
          });
      } catch {
        // Assistant availability must not interrupt the nutrition screens.
      }
    };
    void refresh();
    window.addEventListener(MODEL_CHANGED_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener(MODEL_CHANGED_EVENT, refresh);
    };
  }, []);
  return model ? (
    <div
      className="status-model"
      role="status"
      title={`${model.provider} · ${model.name}`}
    >
      <span>{model.name}</span>
    </div>
  ) : null;
}
