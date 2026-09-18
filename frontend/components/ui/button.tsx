import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

const buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 focus-inset outline-none aria-[invalid=true]:border-destructive", {
  variants: {
    variant: {
      default: "btn-lit text-white has-[>svg]:px-3",
      success: "btn-lit btn-lit-success text-white has-[>svg]:px-3",
      destructive: "btn-lit btn-lit-destructive text-white",
      destructiveOutline: "border border-destructive-40 text-destructive bg-transparent hover:border-destructive hover:bg-destructive-10 has-[>svg]:px-3",
      outline: "btn-tonal text-foreground has-[>svg]:px-3",
      secondary: "btn-tonal text-foreground has-[>svg]:px-3",
      ghost: "hover:bg-accent hover:text-accent-foreground",
      link: "text-primary underline-offset-4 hover:underline",
    },
    size: {
      default: "h-control-default py-2 px-4",
      sm: "h-control-compact py-2 px-3",
      lg: "h-control-large py-2 px-8",
      icon: "h-control-default w-control-default",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = "Button";

export { Button, buttonVariants };
