import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

const inputVariants = cva(
  "flex w-full rounded-md border border-surface-3 bg-input px-3 text-sm text-foreground file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground hover:border-border focus-visible:outline-none focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        default: "h-control-default py-2",
        sm: "h-control-default py-1",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
);

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">, VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, size, ...props }, ref) => {
  return <input type={type} className={cn(inputVariants({ size }), className)} ref={ref} {...props} />;
});
Input.displayName = "Input";

export { Input, inputVariants };
