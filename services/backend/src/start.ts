import { buildServer } from "./server.js";
import { startBackendProcess } from "./process-lifecycle.js";
import { FileShowfileStore } from "./showfile.js";
import { resolve } from "node:path";

const host = "127.0.0.1";
const port = 3000;
const dataDirectory = resolve(process.env.A2_DATA_DIR ?? "data");
const server = buildServer({
  logger: true,
  showfileStore: new FileShowfileStore(dataDirectory),
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
