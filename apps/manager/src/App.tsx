import { useEffect, useState } from "react";
import { FolderKanban, Radio, SlidersHorizontal, Theater } from "lucide-react";
import type {
  ProductionList,
  Showfile,
  ShureTelemetry,
} from "@rvlt/pulse-protocol/http";
import {
  activateProduction,
  createProduction,
  deleteProduction,
  loadObservedDevice,
  loadProductions,
  loadShowfile,
  loadShureTelemetry,
  projectShowfileToDevice,
  saveShowfile,
  type ObservedDevice,
} from "./showfile";
import { ChannelsTab } from "./components/ChannelsTab";
import { EmptyState } from "./components/EmptyState";
import { ProductionsTab } from "./components/ProductionsTab";
import { ReceiversTab } from "./components/ReceiversTab";
import { ShowTab } from "./components/ShowTab";
import { Button } from "./components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsGroupLabel,
  TabsList,
  TabsTrigger,
} from "./components/ui/tabs";

type SaveState = "loading" | "saved" | "dirty" | "saving" | "error";

const noticeStyles: Record<SaveState, string> = {
  loading: "bg-rep-soft",
  saved: "bg-ok-soft",
  dirty: "bg-warn-soft",
  saving: "bg-warn-soft",
  error: "bg-out-soft",
};

export function App() {
  const [showfile, setShowfile] = useState<Showfile | null>(null);
  const [device, setDevice] = useState<ObservedDevice | null>(null);
  const [shure, setShure] = useState<ShureTelemetry | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [message, setMessage] = useState("Loading showfile and audio inputs.");
  const [productions, setProductions] = useState<ProductionList | null>(null);
  const [productionsBusy, setProductionsBusy] = useState(false);
  const [productionsError, setProductionsError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      loadShowfile(controller.signal),
      loadObservedDevice(controller.signal),
      loadShureTelemetry(controller.signal).catch(() => null),
      loadProductions(controller.signal).catch(() => null),
    ])
      .then(([loaded, observed, receiver, productionList]) => {
        const projected = projectShowfileToDevice(loaded, observed);
        const changed =
          loaded.device?.name !== projected.device?.name ||
          loaded.device?.channelCount !== projected.device?.channelCount ||
          JSON.stringify(loaded.channels) !==
            JSON.stringify(projected.channels);
        setDevice(observed);
        setShure(receiver);
        setShowfile(projected);
        setProductions(productionList);
        setSaveState(changed ? "dirty" : "saved");
        setMessage(
          changed
            ? "Observed inputs are ready. Save this showfile to bind their names."
            : "Showfile loaded from this Mac.",
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSaveState("error");
        setMessage(
          error instanceof Error ? error.message : "Manager could not start.",
        );
      });
    return () => controller.abort();
  }, []);

  function update(next: Showfile) {
    setShowfile(next);
    setSaveState("dirty");
    setMessage("Unsaved changes.");
  }

  async function save() {
    if (!showfile || saveState === "saving") return;
    setSaveState("saving");
    setMessage("Saving showfile on this Mac.");
    try {
      const saved = await saveShowfile(showfile);
      setShowfile(saved);
      setSaveState("saved");
      setMessage("Showfile saved. Live now uses these channel names.");
      setProductions(await loadProductions());
    } catch (error) {
      setSaveState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The showfile could not be saved.",
      );
    }
  }

  async function reloadActiveShowfile() {
    try {
      const loaded = await loadShowfile();
      setShowfile(device ? projectShowfileToDevice(loaded, device) : loaded);
      setSaveState("saved");
      setMessage("Showfile loaded from this Mac.");
    } catch (error) {
      setSaveState("error");
      setMessage(
        error instanceof Error ? error.message : "Manager could not start.",
      );
    }
  }

  async function withProductions(action: () => Promise<ProductionList>) {
    setProductionsBusy(true);
    try {
      setProductions(await action());
      setProductionsError(null);
      await reloadActiveShowfile();
    } catch (error) {
      setProductionsError(
        error instanceof Error
          ? error.message
          : "The production request failed.",
      );
    } finally {
      setProductionsBusy(false);
    }
  }

  async function importShowfile(uploaded: Showfile) {
    setProductionsBusy(true);
    try {
      const list = await createProduction(
        uploaded.show.name || "Imported show",
      );
      setProductions(list);
      setProductionsError(null);
      const projected = device
        ? projectShowfileToDevice(uploaded, device)
        : uploaded;
      const saved = await saveShowfile({
        ...projected,
        revision: 0,
        updatedAtUtc: null,
      });
      setShowfile(saved);
      setSaveState("saved");
      setMessage(`Imported "${saved.show.name}" from file.`);
      setProductions(await loadProductions());
    } catch (error) {
      setProductionsError(
        error instanceof Error
          ? error.message
          : "The showfile could not be imported.",
      );
    } finally {
      setProductionsBusy(false);
    }
  }

  async function removeProduction(id: string) {
    setProductionsBusy(true);
    try {
      setProductions(await deleteProduction(id));
      setProductionsError(null);
    } catch (error) {
      setProductionsError(
        error instanceof Error
          ? error.message
          : "The production could not be removed.",
      );
    } finally {
      setProductionsBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper text-foreground">
      <header className="flex min-h-17 flex-wrap items-center gap-5 border-b border-line-2 bg-paper-2 px-6 py-3">
        <div
          className="flex items-center gap-2 font-display text-section font-bold"
          aria-label="Pulse Manager"
        >
          <span aria-hidden="true" className="inline-flex text-ok">
            <svg
              viewBox="0 0 100 100"
              width="20"
              height="20"
              fill="currentColor"
            >
              <rect x="8" y="38" width="12" height="24" rx="6" />
              <rect x="27" y="24" width="12" height="52" rx="6" />
              <rect x="46" y="8" width="12" height="84" rx="6" />
              <rect x="65" y="24" width="12" height="52" rx="6" />
              <rect x="84" y="38" width="12" height="24" rx="6" />
            </svg>
          </span>
          <b className="font-wordmark text-page font-bold tracking-tight">
            Pulse
          </b>
          <em className="font-body text-ui font-semibold not-italic text-muted-foreground">
            Manager
          </em>
        </div>
        <div className="flex flex-col border-l border-line-2 pl-5 leading-tight">
          <span className="font-mono text-badge text-faint">
            Local showfile
          </span>
          <strong className="font-display text-cardhead">
            {showfile?.show.name ?? "Waiting"}
          </strong>
        </div>
        <Button variant="outline" asChild className="ml-auto">
          <a href="/">Open Live</a>
        </Button>
      </header>

      <section
        className={`flex min-h-14 flex-wrap items-center justify-between gap-4 border-b border-line-2 px-6 py-3 ${noticeStyles[saveState]}`}
        role="status"
      >
        <div className="flex flex-col gap-1">
          <strong className="font-display text-cardhead">
            {saveState === "loading"
              ? "Loading showfile."
              : saveState === "saving"
                ? "Saving showfile."
                : saveState === "saved"
                  ? "Showfile saved."
                  : saveState === "dirty"
                    ? "Showfile has unsaved changes."
                    : "Showfile unavailable."}
          </strong>
          <span className="text-caption text-ink-2">{message}</span>
        </div>
        {showfile ? (
          <span className="font-mono text-caption tabular-nums text-rep">
            Revision {showfile.revision}
          </span>
        ) : null}
      </section>

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <span className="font-mono text-badge text-faint">Show setup</span>
            <h1 className="my-1 font-display text-page leading-tight tracking-tight text-foreground">
              Build a showfile
            </h1>
            <p className="max-w-xl text-ui text-ink-2">
              Add the channels you use, name them, then patch each one to a
              physical audio input and optional Shure receiver channel.
            </p>
          </div>
          <Button
            size="primary"
            disabled={
              !showfile || saveState === "saving" || saveState === "saved"
            }
            onClick={() => void save()}
          >
            {saveState === "saving" ? "Saving" : "Save showfile"}
          </Button>
        </div>

        {showfile ? (
          <Tabs
            defaultValue="show"
            orientation="vertical"
            className="flex flex-col gap-6 md:flex-row md:items-start"
          >
            <TabsList className="w-full md:w-64 md:shrink-0 md:border-r-2 md:border-line-2 md:pr-4">
              <TabsGroupLabel>Show setup</TabsGroupLabel>
              <TabsTrigger value="show">
                <Theater aria-hidden="true" />
                Show
              </TabsTrigger>
              <TabsTrigger value="productions">
                <FolderKanban aria-hidden="true" />
                Productions
                {productions?.productions.length
                  ? ` · ${productions.productions.length}`
                  : ""}
              </TabsTrigger>
              <TabsTrigger value="receivers">
                <Radio aria-hidden="true" />
                Receivers
                {showfile.shureReceivers.length
                  ? ` · ${showfile.shureReceivers.length}`
                  : ""}
              </TabsTrigger>
              <TabsTrigger value="channels">
                <SlidersHorizontal aria-hidden="true" />
                Channels
                {showfile.channels.length
                  ? ` · ${showfile.channels.length}`
                  : ""}
              </TabsTrigger>
            </TabsList>
            <div className="min-w-0 flex-1">
              <TabsContent value="show">
                <ShowTab showfile={showfile} onChange={update} />
              </TabsContent>
              <TabsContent value="productions">
                <ProductionsTab
                  productions={productions}
                  activeShowfile={showfile}
                  busy={productionsBusy}
                  error={productionsError}
                  onCreate={(name) =>
                    void withProductions(() => createProduction(name))
                  }
                  onActivate={(id) =>
                    void withProductions(() => activateProduction(id))
                  }
                  onRemove={(id) => void removeProduction(id)}
                  onImport={(uploaded) => void importShowfile(uploaded)}
                />
              </TabsContent>
              <TabsContent value="receivers">
                <ReceiversTab
                  showfile={showfile}
                  shure={shure}
                  onChange={update}
                />
              </TabsContent>
              <TabsContent value="channels">
                <ChannelsTab
                  showfile={showfile}
                  device={device}
                  onChange={update}
                />
              </TabsContent>
            </div>
          </Tabs>
        ) : (
          <EmptyState title="No editable showfile." detail={message} />
        )}
      </main>
    </div>
  );
}
