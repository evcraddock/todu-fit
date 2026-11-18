// Disposable child used only by the interrupted-process recovery regression.
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { openAssistant } from "../src/runtime.mjs";
const models = createModels();
const faux = fauxProvider({ provider: "test", models: [{ id: "test-model" }] });
models.setProvider(faux.provider);
faux.setResponses([
  async () => {
    process.send({ kind: "started" });
    await new Promise(() => {});
  },
]);
const runtime = await openAssistant({
  directory: process.argv[2],
  models,
  vault: async () => ({}),
});
const conversation = await runtime.request({
  type: "conversation_create",
  model: { provider: "test", modelId: "test-model" },
});
const submission = await runtime.request({
  type: "conversation_send",
  id: conversation.id,
  requestId: "crash-retry",
  content: "recover this turn",
});
process.send({
  kind: "admitted",
  conversation: conversation.id,
  submission: submission.id,
});
