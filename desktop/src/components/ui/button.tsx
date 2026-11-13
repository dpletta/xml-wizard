import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[13px] font-medium transition-colors select-none disabled:opacity-45 disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-card hover:bg-primary-hover",
        secondary: "bg-surface text-foreground border border-border shadow-card hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        soft: "bg-primary-soft text-primary hover:brightness-95",
        danger: "text-danger hover:bg-danger-soft",
      },
      size: {
        sm: "h-7 px-2.5",
        md: "h-8.5 px-3.5",
        lg: "h-10 px-5 text-sm",
        icon: "size-8.5",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";
