import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border-2 text-ui font-semibold transition-transform duration-[120ms] ease-[cubic-bezier(0.2,0.8,0.3,1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red disabled:pointer-events-none disabled:cursor-default [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-red bg-red text-primary-foreground shadow-button hover:-translate-y-px active:translate-y-0.5 active:shadow-[0_1px_0_var(--red-700)] disabled:border-line-2 disabled:bg-rep-soft disabled:text-rep disabled:shadow-none",
        outline:
          "border-line-2 bg-card text-foreground hover:-translate-y-px active:translate-y-0.5 disabled:text-rep",
        ghost:
          "border-transparent bg-transparent text-foreground hover:bg-secondary active:translate-y-0.5",
        destructive:
          "border-line-2 bg-transparent text-out hover:-translate-y-px active:translate-y-0.5",
      },
      size: {
        default: "min-h-11 px-4",
        primary: "min-h-14 px-6",
        sm: "min-h-9 px-3 text-badge",
        icon: "size-11 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  type = "button",
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
