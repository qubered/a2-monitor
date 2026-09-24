import type { Showfile } from "@rvlt/pulse-protocol/http";
import { CardOverline } from "./ui/card";
import { Input } from "./ui/input";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";

export function ShowTab({
  showfile,
  onChange,
}: {
  showfile: Showfile;
  onChange: (next: Showfile) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <CardOverline>Identity</CardOverline>
        <h2 className="mt-1 font-display text-section leading-tight text-foreground">
          Show
        </h2>
        <p className="mt-1 max-w-xl text-caption text-muted-foreground">
          The name saved with this production's showfile.
        </p>
      </div>
      <Table className="max-w-xl">
        <TableBody>
          <TableRow>
            <TableCell className="w-40 font-semibold text-foreground">
              Show name
            </TableCell>
            <TableCell>
              <Input
                id="show-name"
                aria-label="Show name"
                value={showfile.show.name}
                maxLength={120}
                onChange={(event) =>
                  onChange({
                    ...showfile,
                    show: { name: event.target.value },
                  })
                }
              />
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-semibold text-foreground">
              Revision
            </TableCell>
            <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
              {showfile.revision}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-semibold text-foreground">
              Channels
            </TableCell>
            <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
              {showfile.channels.length}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-semibold text-foreground">
              Shure receivers
            </TableCell>
            <TableCell className="font-mono text-table tabular-nums text-muted-foreground">
              {showfile.shureReceivers.length}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
