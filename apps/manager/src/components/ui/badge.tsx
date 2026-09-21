import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-badge font-bold",
  {
    variants: {
      variant: {
        neutral: "bg-rep-soft text-rep",
        ok: "bg-ok-soft text-ok",
        warn: "bg-warn-soft text-warn",
        out: "bg-out-soft text-out",
        purple: "bg-purple-soft text-purple",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, className }))} {...props} />
  );
}

export { Badge, badgeVariants };
