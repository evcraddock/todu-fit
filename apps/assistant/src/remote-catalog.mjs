import { getModelType } from "@earendil-works/pi-ai";

const REFRESH_INTERVAL = 4 * 60 * 60 * 1000;
const TYPES = ["chat", "image", "classifier"];

// Like Pi CLI, overlay static providers with the independently published pi.dev
// catalog. Providers with their own discovery retain that implementation.
export function withRemoteCatalog(provider, generatedAt, fetchCatalog = fetch) {
  if (provider.refreshModels) return provider;
  let remote = [];
  const all = () => {
    const entries = new Map();
    for (const model of [
      ...(provider.getAllModels?.() ?? provider.getModels()),
      ...remote,
    ])
      entries.set(`${getModelType(model)}:${model.id}`, model);
    return [...entries.values()];
  };
  const newer = (entry) =>
    entry && (generatedAt === undefined || entry.lastModified > generatedAt);
  return {
    ...provider,
    getAllModels: all,
    getModels: () => all().filter((model) => getModelType(model) === "chat"),
    refreshModelsAuth: "configured",
    async refreshModels(context) {
      const { stored, signal } = context;
      if (
        !(await context.publish({
          update: () => {
            remote = newer(stored)
              ? stored.models.filter((model) => model.provider === provider.id)
              : [];
          },
        }))
      )
        return;
      if (!context.allowNetwork || signal.aborted) return;
      if (
        !context.force &&
        stored?.lastModified !== undefined &&
        Date.now() - stored.checkedAt < REFRESH_INTERVAL
      )
        return;
      const url = new URL(
        `/api/models/providers/${encodeURIComponent(provider.id)}`,
        "https://pi.dev",
      );
      url.searchParams.set("types", TYPES.join(","));
      const response = await fetchCatalog(url, {
        headers: {
          accept: "application/json",
          ...(stored?.models.length && stored.etag
            ? { "if-none-match": stored.etag }
            : {}),
        },
        signal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]),
      });
      const checkedAt = Date.now();
      if (response.status === 304 && stored) {
        await context.publish({ persist: { ...stored, checkedAt } });
        return;
      }
      if (response.status === 404 || response.status === 501) {
        await context.publish({
          persist: {
            ...(stored ?? { models: [] }),
            checkedAt,
            lastModified: 0,
            etag: undefined,
          },
        });
        return;
      }
      if (!response.ok)
        throw Error(
          `Model catalog request failed for ${provider.id}: ${response.status}`,
        );
      const value = await response.json();
      const entries = Array.isArray(value)
        ? value
        : value && typeof value === "object"
          ? (value.models ?? Object.values(value))
          : undefined;
      if (!Array.isArray(entries))
        throw Error(`Invalid model catalog for ${provider.id}`);
      const models = entries
        .filter(
          (model) =>
            model &&
            typeof model.id === "string" &&
            (model.type === undefined || TYPES.includes(model.type)),
        )
        .map((model) => ({ ...model, provider: provider.id }));
      const entry = {
        models,
        checkedAt,
        lastModified: Date.parse(response.headers.get("last-modified")) || 0,
        etag: response.headers.get("etag") ?? undefined,
      };
      await context.publish({
        persist: entry,
        update: () => {
          remote = newer(entry) ? models : [];
        },
      });
    },
  };
}
