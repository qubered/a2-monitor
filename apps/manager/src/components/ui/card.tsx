import * as React from "react";
import { cn } from "../../lib/utils";

function CardOverline({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("font-mono text-badge text-faint", className)}
      {...props}
    />
  );
}

export { CardOverline };
