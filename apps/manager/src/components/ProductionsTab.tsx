import { useRef, useState } from "react";
import { Download, Trash2, Upload } from "lucide-react";
import type { ProductionList, Showfile } from "@a2-monitor/protocol/http";
import {
  downloadShowfile,
  loadProductionShowfile,
  readUploadedShowfile,
} from "../showfile";
import { EmptyState } from "./EmptyState";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { CardOverline } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

function formatUpdatedAt(updatedAtUtc: string | null): string {
  if (!updatedAtUtc) return "Never saved";
  return new Date(updatedAtUtc).toLocaleString();
}

export function ProductionsTab({
  productions,
  activeShowfile,
  busy,
  error,
  onCreate,
  onActivate,
  onRemove,
  onImport,
}: {
  productions: ProductionList | null;
  activeShowfile: Showfile;
  busy: boolean;
  error: string | null;
  onCreate: (name: string) => void;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
  onImport: (showfile: Showfile) => void;
}) {
  const [name, setName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  async function handleDownload(id: string) {
    setLocalError(null);
    setDownloadingId(id);
    try {
      const showfile =
        id === productions?.activeId
          ? activeShowfile
          : await loadProductionShowfile(id);
      downloadShowfile(showfile);
    } catch (downloadError) {
      setLocalError(
        downloadError instanceof Error
          ? downloadError.message
          : "The showfile could not be downloaded.",
      );
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLocalError(null);
    try {
      onImport(await readUploadedShowfile(file));
    } catch (importError) {
      setLocalError(
        importError instanceof Error
          ? importError.message
          : "That file could not be imported.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <CardOverline>Show library</CardOverline>
          <h2 className="mt-1 font-display text-section leading-tight text-foreground">
            Productions
          </h2>
          <p className="mt-1 max-w-xl text-caption text-muted-foreground">
            Every production saved on this Mac. Activate one to edit its show,
            receivers and channels.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim().length === 0) return;
              onCreate(name.trim());
              setName("");
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-production-name">New production</Label>
              <Input
                id="new-production-name"
                value={name}
                maxLength={120}
                placeholder="Production name"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <Button type="submit" variant="outline" disabled={busy}>
              Create
            </Button>
          </form>
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            aria-label="Import showfile"
            className="sr-only"
            onChange={(event) => void handleImportFile(event)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => importInput.current?.click()}
          >
            <Upload aria-hidden="true" />
            Import showfile
          </Button>
        </div>
      </div>

      {error || localError ? (
        <p role="alert" className="text-caption text-out">
          {error ?? localError}
        </p>
      ) : null}

      {!productions || productions.productions.length === 0 ? (
        <EmptyState
          title="No productions yet."
          detail="Create one, or import a showfile, to start building a show."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-28">Channels</TableHead>
              <TableHead className="w-28">Receivers</TableHead>
              <TableHead className="w-24">Revision</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-56">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {productions.productions.map((production) => {
              const isActive = production.id === productions.activeId;
              return (
                <TableRow key={production.id}>
                  <TableCell className="font-semibold text-foreground">
                    {production.name}
                  </TableCell>
                  <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
                    {production.channelCount}
                  </TableCell>
                  <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
                    {production.receiverCount}
                  </TableCell>
                  <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
                    {production.revision}
                  </TableCell>
                  <TableCell className="text-caption text-muted-foreground">
                    {formatUpdatedAt(production.updatedAtUtc)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={isActive ? "ok" : "neutral"}>
                      {isActive ? "Active" : "Saved"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={downloadingId === production.id}
                        aria-label={`Download ${production.name}`}
                        onClick={() => void handleDownload(production.id)}
                      >
                        <Download aria-hidden="true" />
                      </Button>
                      {isActive ? null : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => onActivate(production.id)}
                        >
                          Activate
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="icon"
                        aria-label={`Remove ${production.name}`}
                        disabled={busy || isActive}
                        onClick={() => onRemove(production.id)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
