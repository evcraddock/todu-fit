import { serve } from "../src/server.mjs";
import { openAssistant } from "../src/runtime.mjs";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxProvider,
  fauxAssistantMessage,
} from "@earendil-works/pi-ai/providers/faux";
let values = {};
const vault = {
  available: async () => true,
  exists: async () => false,
  request: async (op) => {
    if (op.type === "write") values = structuredClone(op.value);
    return structuredClone(values);
  },
};
const faux = fauxProvider({ provider: "test", models: [{ id: "test-model" }] });
const response = async () => {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return fauxAssistantMessage("completed without a client");
};
faux.setResponses([response, response]);
const models = createModels();
models.setProvider(faux.provider);
try {
  const service = await serve({
    directory: process.argv[2],
    version: "fixture",
    vault,
    openRuntime: (options) => openAssistant({ ...options, models }),
  });
  process.once("SIGTERM", () => void service.close());
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
