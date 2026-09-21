import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { ProductionList } from "@a2-monitor/protocol/http";
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
  busy,
  error,
  onCreate,
  onActivate,
  onRemove,
}: {
  productions: ProductionList | null;
  busy: boolean;
  error: string | null;
  onCreate: (name: string) => void;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState("");

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
      </div>

      {error ? (
        <p role="alert" className="text-caption text-out">
          {error}
        </p>
      ) : null}

      {!productions || productions.productions.length === 0 ? (
        <EmptyState
          title="No productions yet."
          detail="Create one to start building a showfile."
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
              <TableHead className="w-40">
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
