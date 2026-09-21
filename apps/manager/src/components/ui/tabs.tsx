import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../../lib/utils";

const Tabs = TabsPrimitive.Root;

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex min-h-14 items-center gap-2 overflow-x-auto",
        "data-[orientation=vertical]:min-h-0 data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch data-[orientation=vertical]:gap-0.5 data-[orientation=vertical]:overflow-x-visible",
        className,
      )}
      {...props}
    />
  );
}

function TabsGroupLabel({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "px-3 pb-1 pt-4 font-mono text-badge text-faint first:pt-0",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        // Horizontal (default): a row of pill buttons.
        "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full border-2 border-line-2 bg-card px-4 text-ui font-semibold text-foreground transition-transform duration-[120ms]",
        "data-[state=active]:border-ink data-[state=active]:bg-ink data-[state=active]:text-paper data-[state=active]:shadow-card",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        "active:translate-y-0.5",
        // Vertical: a flush-left settings-sidebar nav row.
        "data-[orientation=vertical]:min-h-11 data-[orientation=vertical]:w-full data-[orientation=vertical]:justify-start data-[orientation=vertical]:rounded-md data-[orientation=vertical]:border-transparent data-[orientation=vertical]:bg-transparent data-[orientation=vertical]:px-3 data-[orientation=vertical]:text-left data-[orientation=vertical]:shadow-none",
        "data-[orientation=vertical]:data-[state=inactive]:hover:bg-secondary",
        "data-[orientation=vertical]:data-[state=active]:border-transparent data-[orientation=vertical]:data-[state=active]:shadow-none",
        "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        "flex flex-col gap-4 focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsGroupLabel, TabsList, TabsTrigger, TabsContent };
