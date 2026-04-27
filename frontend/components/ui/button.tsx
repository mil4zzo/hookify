import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

const buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring-50 focus-visible:ring-[3px] aria-invalid:ring-destructive-20 dark:aria-invalid:ring-destructive-40 aria-invalid:border-destructive", {
  variants: {
    variant: {
      default: "primary-gradient text-primary-foreground border border-primary-foreground-5 has-[>svg]:px-3",
      primary: "bg-primary text-primary-foreground border border-primary-foreground-5 has-[>svg]:px-3",
      neutral: "neutral-gradient text-primary-foreground border border-primary-foreground-5 has-[>svg]:px-3",
      success: "success-gradient text-success-foreground border border-primary-foreground-5 has-[>svg]:px-3",
      destructive: "destructive-gradient text-destructive-foreground border border-primary-foreground-5",
      destructiveOutline: "border border-destructive-50 text-destructive bg-transparent hover:border-destructive hover:bg-destructive-10 has-[>svg]:px-3",
      outline: "border hover:bg-accent hover:text-accent-foreground border-border has-[>svg]:px-3",
      secondary: "border bg-input-30 hover:bg-accent hover:text-accent-foreground border-border has-[>svg]:px-3",
      ghost: "hover:bg-accent hover:text-accent-foreground",
      link: "text-brand underline-offset-4 hover:underline",
    },
    size: {
      default: "h-10 py-2 px-4",
      sm: "h-9 py-2 px-3",
      lg: "h-11 py-2 px-8",
      icon: "h-10 w-10",
    },
    shadow: {
      auto: null,
      none: "shadow-none",
      xs: "shadow-xs",
      sm: "shadow-sm",
      md: "shadow-md",
      lg: "shadow-lg",
      xl: "shadow-xl",
      "2xl": "shadow-2xl",
    },
  },
  compoundVariants: [
    {
      variant: "destructiveOutline",
      shadow: "auto",
      className: "shadow-xs",
    },
    {
      variant: "outline",
      shadow: "auto",
      className: "shadow-xs",
    },
    {
      variant: "secondary",
      shadow: "auto",
      className: "shadow-xs",
    },
  ],
  defaultVariants: {
    variant: "default",
    size: "default",
    shadow: "auto",
  },
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, shadow, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, shadow, className }))} ref={ref} {...props} />;
});
Button.displayName = "Button";

export { Button, buttonVariants };
