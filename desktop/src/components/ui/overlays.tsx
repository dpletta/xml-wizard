import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, title, description, wide, ...props }:
  React.ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: React.ReactNode; wide?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px] animate-fade" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-surface shadow-pop animate-fade focus:outline-none",
          wide ? "max-w-3xl" : "max-w-lg", className)}
        onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).focus(); }}
        {...props}>
        <div className="flex items-start gap-4 px-6 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="text-base font-semibold tracking-tight">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-[13px] text-muted-foreground">{description}</DialogPrimitive.Description>
            ) : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close aria-label="Close" className="-mr-2 -mt-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ className, align = "end", sideOffset = 8, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={sideOffset}
        className={cn("z-50 rounded-xl border border-border bg-surface p-3 shadow-pop animate-in focus:outline-none", className)} {...props} />
    </PopoverPrimitive.Portal>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
export function Tip({ text, children, side = "bottom" }: { text: React.ReactNode; children: React.ReactElement; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6}
          className="z-[60] max-w-64 rounded-md bg-foreground px-2 py-1 text-[11.5px] font-medium text-background shadow-lift animate-fade">
          {text}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;
export function MenuContent({ className, align = "end", sideOffset = 6, ...props }: React.ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content align={align} sideOffset={sideOffset}
        className={cn("z-50 min-w-56 rounded-xl border border-border bg-surface p-1.5 shadow-pop animate-in focus:outline-none", className)} {...props} />
    </MenuPrimitive.Portal>
  );
}
export function MenuItem({ className, icon, hint, children, ...props }: React.ComponentProps<typeof MenuPrimitive.Item> & { icon?: React.ReactNode; hint?: string }) {
  return (
    <MenuPrimitive.Item
      className={cn("flex cursor-pointer select-none items-start gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-45 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground", className)}
      {...props}>
      {icon}
      <span className="min-w-0">
        <span className="block font-medium">{children}</span>
        {hint ? <span className="block text-[11.5px] leading-snug text-muted-foreground">{hint}</span> : null}
      </span>
    </MenuPrimitive.Item>
  );
}
export function MenuSeparator() {
  return <MenuPrimitive.Separator className="my-1.5 h-px bg-border" />;
}
export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <MenuPrimitive.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</MenuPrimitive.Label>;
}
