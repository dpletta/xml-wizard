import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { C } from "@/lib/core";
import { lookOf } from "@/lib/kinds";
import { useStore } from "@/lib/store";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const project = useStore((s) => s.project);
  const reveal = useStore((s) => s.reveal);
  if (!project) return null;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px] animate-fade" />
        <DialogPrimitive.Content aria-describedby={undefined}
          className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-pop animate-fade focus:outline-none">
          <DialogPrimitive.Title className="sr-only">Find a question</DialogPrimitive.Title>
          <Command label="Find a question" loop>
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <Command.Input autoFocus placeholder="Find a question by its text or variable name…"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </div>
            <Command.List className="thin-scroll max-h-[50vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">No question matches.</Command.Empty>
              {project.forms.map((form) => (
                <Command.Group key={form.id} heading={form.label}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground">
                  {form.items.filter(C.isField).map((f) => {
                    const Icon = lookOf(f).icon;
                    return (
                      <Command.Item key={f.id} value={f.name} keywords={[C.stripHtml(f.label)]}
                        onSelect={() => { reveal(f.id); onOpenChange(false); }}
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] data-[selected=true]:bg-muted">
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{C.stripHtml(f.label) || f.name}</span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{f.name}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
