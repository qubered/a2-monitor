import { buildServer } from "./server.js";
import { startBackendProcess } from "./process-lifecycle.js";
import { FileAlertPersistence } from "./alerts.js";
import { FileCheckPersistence } from "./checks.js";
import { FileReportPersistence } from "./reports.js";
import { FileSessionPersistence } from "./sessions.js";
import { NodeObserver } from "./node-observer.js";
import { FileProductionStore } from "./productions.js";
import { LevelHistoryStore } from "./level-history.js";
import { SqliteLevelHistory } from "./level-history-db.js";
import { resolve } from "node:path";

const host = "127.0.0.1";
const port = 3000;
const dataDirectory = resolve(process.env.A2_DATA_DIR ?? "data");
// The audio node the backend reads normalized observations from. Development
// runs the listen gateway on 3001; the packaged app points this at its port.
const nodeOrigin = process.env.A2_NODE_ORIGIN ?? "http://127.0.0.1:3001";
const history = new LevelHistoryStore({
  persistence: new SqliteLevelHistory(dataDirectory),
  onError: (error) => console.error("level history persistence", error),
});
const server = buildServer({
  history,
  logger: true,
  productionStore: new FileProductionStore(dataDirectory),
  alertPersistence: new FileAlertPersistence(dataDirectory),
  checkPersistence: new FileCheckPersistence(dataDirectory),
  reportPersistence: new FileReportPersistence(dataDirectory),
  sessionPersistence: new FileSessionPersistence(dataDirectory),
  nodeSource: new NodeObserver({ origin: nodeOrigin }),
});
server.addHook("onClose", async () => history.close());

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
