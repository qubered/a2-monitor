import { buildServer } from "./server.js";
import { startBackendProcess } from "./process-lifecycle.js";
import { FileProductionStore } from "./productions.js";
import { resolve } from "node:path";

const host = "127.0.0.1";
const port = 3000;
const dataDirectory = resolve(process.env.A2_DATA_DIR ?? "data");
const server = buildServer({
  logger: true,
  productionStore: new FileProductionStore(dataDirectory),
});

try {
  await startBackendProcess({
    server,
    host,
    port,
    onShutdownError: (error) => {
      server.log.error(error);
      process.exitCode = 1;
    },
  });
} catch (error) {
  server.log.error(error);
  process.exitCode = 1;
}
