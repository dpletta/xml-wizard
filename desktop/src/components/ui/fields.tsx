import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-lg border border-border bg-surface px-2.5 text-[13px] text-foreground shadow-card placeholder:text-muted-foreground/70 transition-colors hover:border-border-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60 read-only:bg-muted";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(control, "h-8.5", className)} {...props} />,
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(control, "py-2 leading-snug resize-y min-h-16", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(control, "h-8.5 pr-7 appearance-none bg-no-repeat bg-[right_0.5rem_center] bg-[length:0.9rem]", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...props}>
      {children}
    </select>
  ),
);
NativeSelect.displayName = "NativeSelect";

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11.5px] leading-snug text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function Switch({ checked, onCheckedChange, label, hint, disabled }: {
  checked: boolean; onCheckedChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean;
}) {
  const id = React.useId();
  return (
    <div className="flex items-start gap-3">
      <SwitchPrimitive.Root id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}
        className="mt-0.5 h-5 w-9 shrink-0 rounded-full bg-border-strong transition-colors data-[state=checked]:bg-primary disabled:opacity-50">
        <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
      </SwitchPrimitive.Root>
      <label htmlFor={id} className="text-[13px] leading-snug">
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-[11.5px] text-muted-foreground">{hint}</span> : null}
      </label>
    </div>
  );
}

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "primary" | "ok" | "warn" | "danger" | "info";
}) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    primary: "bg-primary-soft text-primary",
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    info: "bg-info-soft text-info",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4", tones[tone], className)} {...props} />;
}
