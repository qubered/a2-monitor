import type { Showfile } from "@a2-monitor/protocol/http";
import {
  Card,
  CardContent,
  CardHeader,
  CardOverline,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function ShowTab({
  showfile,
  onChange,
}: {
  showfile: Showfile;
  onChange: (next: Showfile) => void;
}) {
  return (
    <Card className="max-w-md">
      <CardHeader className="flex-col items-start gap-1">
        <CardOverline>Identity</CardOverline>
        <CardTitle>Show</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <Label htmlFor="show-name">Show name</Label>
          <Input
            id="show-name"
            value={showfile.show.name}
            maxLength={120}
            onChange={(event) =>
              onChange({ ...showfile, show: { name: event.target.value } })
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
