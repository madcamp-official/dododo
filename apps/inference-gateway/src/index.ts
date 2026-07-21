import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { OllamaProvider } from "../../../packages/context-engine/src/index.ts";
import { loadGatewayConfig } from "./config.ts";
import { createGatewayRuntime } from "./server.ts";

const config = loadGatewayConfig();
if (config.databasePath !== ":memory:") mkdirSync(dirname(config.databasePath), { recursive: true });

const provider = new OllamaProvider({
  baseUrl: config.ollamaBaseUrl,
  textModel: config.textModel,
  visionModel: config.visionModel,
  defaultTimeoutMs: config.ollamaTimeoutMs,
});
const runtime = createGatewayRuntime(config, { provider });
const address = await runtime.listen();
console.log(`DoDoDo Inference Gateway listening on ${address.address}:${address.port}`);

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`DoDoDo Inference Gateway stopping (${signal})`);
  await runtime.close();
}

process.on("SIGTERM", () => void stop("SIGTERM").then(() => process.exit(0)));
process.on("SIGINT", () => void stop("SIGINT").then(() => process.exit(0)));
