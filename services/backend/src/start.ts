import { buildServer } from "./server.js";
import { startBackendProcess } from "./process-lifecycle.js";

const host = "127.0.0.1";
const port = 3000;
const server = buildServer({ logger: true });

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
