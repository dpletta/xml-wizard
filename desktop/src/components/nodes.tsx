import { memo } from "react";
import { BaseEdge, Handle, Position, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import { CornerDownRight, Fingerprint, GripVertical, Plus, TriangleAlert } from "lucide-react";
import { C, type Field, type Form, type Section } from "@/lib/core";
import { hasChips, MAX_CHIPS, type Slot } from "@/lib/layout";
import { lookFor, lookOf } from "@/lib/kinds";
import { useStore } from "@/lib/store";
import { cn, plural } from "@/lib/utils";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "./ui/overlays";

export type ItemNodeT = Node<{ slot: Slot; rev: number; editable: boolean; worst?: "error" | "warning"; flash: boolean }, "item">;
export type SectionNodeT = Node<{ slot: Slot; rev: number; editable: boolean }, "section">;
export type FormNodeT = Node<{ form: Form; rev: number; editable: boolean; number: number; active: boolean }, "form">;
export type AppNode = ItemNodeT | SectionNodeT | FormNodeT;

export const ItemNode = memo(function ItemNode({ data, selected }: NodeProps<ItemNodeT>) {
  const { slot, editable, worst } = data;
  const f = slot.item as Field;
  const look = lookOf(f);
  const Icon = look.icon;
  const label = C.stripHtml(f.label) || (f.type === "descriptive" ? "Text block" : "Untitled question");
  // As many answers as fit on one line, by a rough width for each.
  const chips: Field["choices"] = [];
  if (hasChips(f)) {
    let room = slot.w - 24 - (f.choices.length > 1 ? 30 : 0);
    for (const c of f.choices) {
      const w = Math.min(112, 18 + 6.1 * (C.stripHtml(c.label) || c.code).length) + 4;
      if (chips.length >= MAX_CHIPS || (chips.length > 0 && w > room)) break;
      chips.push(c);
      room -= w;
    }
  }
  const more = hasChips(f) ? f.choices.length - chips.length : 0;
  const canBranchFrom = editable && f.type !== "descriptive";
  return (
    <div
      title={C.stripHtml(f.label)}
      className={cn(
        "relative flex h-full w-full flex-col rounded-xl border bg-surface px-3 py-3 shadow-card transition-[box-shadow,border-color]",
        selected ? "border-primary shadow-lift ring-2 ring-primary/20" : "border-border hover:border-border-strong hover:shadow-lift",
        !selected && worst === "error" && "border-danger/70",
        !selected && worst === "warning" && "border-warn/60",
        data.flash && "animate-flash",
      )}>
      <Handle id="in" type="target" position={Position.Left} className="card-target" isConnectableStart={false} isConnectable={editable && !f.rid} />
      <Handle id="in-r" type="target" position={Position.Right} isConnectable={false} />
      <Handle id="tree" type="source" position={Position.Bottom} style={{ left: 12 }} isConnectable={false} />
      {slot.cond ? (
        <div className="mb-1 flex h-5 min-w-0">
          <span title={"Shown only if " + slot.condFull}
            className="inline-flex min-w-0 items-center gap-1 rounded-md bg-primary-soft px-1.5 text-[11px] font-medium text-primary">
            <CornerDownRight className="size-3 shrink-0" />
            <span className="truncate">{slot.cond}</span>
          </span>
        </div>
      ) : null}
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", look.tile)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-[13px] font-medium leading-5", !C.stripHtml(f.label) && "italic text-muted-foreground")}>{label}</div>
          <div className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <span className="truncate font-mono">{f.name}</span>
            {f.required ? <span className="shrink-0 font-medium text-primary">required</span> : null}
            {f.identifier ? <Fingerprint className="size-3 shrink-0" aria-label="Identifier" /> : null}
          </div>
        </div>
        {worst ? <TriangleAlert className={cn("size-4 shrink-0", worst === "error" ? "text-danger" : "text-warn")} /> : null}
      </div>
      {chips.length ? (
        <div className="mt-2 flex min-w-0 items-center gap-1">
          {chips.map((c) => (
            <span key={c.code}
              title={canBranchFrom ? `Drag onto a question to show it only for “${C.stripHtml(c.label)}”` : `${c.code} = ${C.stripHtml(c.label)}`}
              className={cn(
                "relative inline-flex h-[22px] min-w-0 max-w-28 shrink items-center rounded-full border border-border bg-muted/70 px-2 text-[11px] text-foreground/80",
                canBranchFrom && "nodrag hover:border-primary hover:bg-primary-soft hover:text-primary",
              )}>
              <span className="truncate">{C.stripHtml(c.label) || c.code}</span>
              {canBranchFrom ? <Handle id={"c:" + c.code} type="source" position={Position.Right} className="chip-source" /> : null}
            </span>
          ))}
          {more > 0 ? <span className="shrink-0 text-[11px] text-muted-foreground">+{more}</span> : null}
        </div>
      ) : null}
      <Handle id="any" type="source" position={Position.Right} isConnectable={canBranchFrom}
        className={canBranchFrom ? "dot-source nodrag" : undefined}
        title={canBranchFrom ? "Drag onto a question to show it only when this one is answered" : undefined} />
    </div>
  );
});

export const SectionNode = memo(function SectionNode({ data, selected }: NodeProps<SectionNodeT>) {
  const s = data.slot.item as Section;
  return (
    <div className={cn("flex h-full w-full items-end gap-2 rounded-lg px-1.5 pb-1.5", selected && "bg-primary-soft")}>
      <span className={cn("truncate text-[11px] font-semibold uppercase tracking-[0.08em]", selected ? "text-primary" : "text-muted-foreground")}>
        {C.stripHtml(s.label) || "Section"}
      </span>
      <span className="mb-[7px] h-px min-w-4 flex-1 bg-border-strong/70" />
    </div>
  );
});

export const FormNode = memo(function FormNode({ data }: NodeProps<FormNodeT>) {
  const { form, editable, number, active } = data;
  const addItem = useStore((s) => s.addItem);
  const fields = form.items.filter(C.isField);
  const gated = fields.filter((f) => f.logic.trim()).length;
  return (
    <div className={cn("h-full w-full rounded-2xl border bg-surface/60 transition-colors", active ? "border-primary/70 ring-2 ring-primary/15" : "border-border")}>
      <div className={cn("form-grip flex h-[58px] items-center gap-3 px-4", editable && "cursor-grab active:cursor-grabbing")}>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-[12px] font-semibold text-background">{number}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight">{form.label}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {plural(fields.length, "question")}{gated ? ` · ${gated} with branching` : ""}
          </div>
        </div>
        {editable ? <GripVertical className="size-4 shrink-0 text-muted-foreground/60" /> : null}
      </div>
      {editable ? (
        <div className="nodrag nopan absolute inset-x-3.5 bottom-3">
          <Menu>
            <MenuTrigger asChild>
              <button className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary">
                <Plus className="size-3.5" /> Add a question
              </button>
            </MenuTrigger>
            <MenuContent align="center" className="thin-scroll max-h-80 overflow-y-auto">
              <MenuLabel>Add to {form.label}</MenuLabel>
              {C.KINDS.map((k) => {
                const Icon = lookFor(k.key).icon;
                return (
                  <MenuItem key={k.key} icon={<Icon />} onSelect={() => addItem(k.key, form.id, form.items.length)}>{k.label}</MenuItem>
                );
              })}
            </MenuContent>
          </Menu>
        </div>
      ) : null}
    </div>
  );
});

/** The file-tree connector: down from the controlling question, then across into the one it shows. */
export function ElbowEdge({ sourceX, sourceY, targetX, targetY, ...rest }: EdgeProps<Edge>) {
  const r = Math.min(10, Math.abs(targetX - sourceX), Math.abs(targetY - sourceY));
  const path = `M ${sourceX} ${sourceY} V ${targetY - r} Q ${sourceX} ${targetY} ${sourceX + r} ${targetY} H ${targetX}`;
  return <BaseEdge path={path} style={rest.style} interactionWidth={0} />;
}

export const nodeTypes = { item: ItemNode, section: SectionNode, form: FormNode };
export const edgeTypes = { elbow: ElbowEdge };
