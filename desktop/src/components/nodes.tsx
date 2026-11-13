import { memo, useEffect } from "react";
import { BaseEdge, Handle, Position, useUpdateNodeInternals, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import { CornerDownRight, Fingerprint, GripVertical, Plus, TriangleAlert } from "lucide-react";
import { C, type Field, type Form } from "@/lib/core";
import { hasChips, type SectionBox, type Slot } from "@/lib/layout";
import { lookFor, lookOf } from "@/lib/kinds";
import { useStore } from "@/lib/store";
import { cn, plural } from "@/lib/utils";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "./ui/overlays";

export type ItemNodeT = Node<{ slot: Slot; rev: number; editable: boolean; worst?: "error" | "warning"; flash: boolean }, "item">;
export type SectionNodeT = Node<{ section: SectionBox; rev: number; editable: boolean }, "section">;
export type FormNodeT = Node<{ form: Form; rev: number; editable: boolean; number: number; active: boolean }, "form">;
export type AppNode = ItemNodeT | SectionNodeT | FormNodeT;

export const ItemNode = memo(function ItemNode({ data, selected }: NodeProps<ItemNodeT>) {
  const { slot, editable, worst } = data;
  const f = slot.item as Field;
  const look = lookOf(f);
  const Icon = look.icon;
  const label = C.stripHtml(f.label) || (f.type === "descriptive" ? "Text block" : "Untitled question");
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => { updateNodeInternals(f.id); }, [f.id, data.rev, slot.h, updateNodeInternals]);
  const choices = hasChips(f) ? f.choices : [];
  const canBranchFrom = editable && f.type !== "descriptive";
  return (
    <div
      title={C.stripHtml(f.label)}
      className={cn(
        "question-card relative flex h-full w-full flex-col rounded-xl border bg-surface px-3 py-3 transition-[box-shadow,border-color]",
        selected ? "border-primary ring-2 ring-primary/20" : "hover:border-border-strong",
        !selected && worst === "error" && "border-danger/70",
        !selected && worst === "warning" && "border-warn/60",
        data.flash && "animate-flash",
      )}>
      <Handle id="in" type="target" position={Position.Left} className="card-target" isConnectableStart={false} isConnectable={editable && !f.rid} />
      <Handle id="in-left" type="target" position={Position.Left} style={{ top: 30 }} isConnectable={false} />
      <Handle id="in-right" type="target" position={Position.Right} style={{ top: 30 }} isConnectable={false} />
      <Handle id="out-left" type="source" position={Position.Left} style={{ top: 48 }} isConnectable={false} />
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
      {choices.length ? (
        <div className="mt-2 min-w-0" role="list" aria-label="Response options">
          <div className="mb-1 text-[10px] font-medium text-muted-foreground">Response options</div>
          {choices.map((c, i) => (
            <div key={`${c.code}:${i}`} role="listitem"
              title={canBranchFrom ? `Drag onto a question to show it only for “${C.stripHtml(c.label)}”` : `${c.code} = ${C.stripHtml(c.label)}`}
              className={cn("response-option relative mb-1 flex h-[26px] min-w-0 items-center gap-2 rounded border px-2 text-[11px]",
                canBranchFrom && "nodrag hover:border-primary hover:bg-primary-soft")}>
              <span className="shrink-0 font-mono text-muted-foreground">{c.code}</span>
              <span className="truncate">{C.stripHtml(c.label) || c.code}</span>
              <Handle id={"choice-right:" + c.code} type="source" position={Position.Right}
                className="response-source" isConnectable={canBranchFrom} />
              <Handle id={"choice-left:" + c.code} type="source" position={Position.Left} isConnectable={false} />
            </div>
          ))}
        </div>
      ) : null}
      <Handle id="out-right" type="source" position={Position.Right} style={{ top: 48 }} isConnectable={canBranchFrom}
        className={canBranchFrom ? "dot-source nodrag" : undefined}
        title={canBranchFrom ? "Drag onto a question to show it only when this one is answered" : undefined} />
    </div>
  );
});

export const SectionNode = memo(function SectionNode({ data, selected }: NodeProps<SectionNodeT>) {
  const { section } = data;
  return (
    <div className={cn("section-box h-full w-full rounded-xl border", selected && "ring-2 ring-primary/20")}>
      <div className="section-grip flex h-[42px] items-center gap-2 px-3">
        <span className="text-[10px] font-medium opacity-80">Section</span>
        <span className="truncate text-xs font-semibold" title={C.stripHtml(section.label)}>{C.stripHtml(section.label) || "Untitled section"}</span>
        {data.editable && !section.implicit ? <GripVertical className="ml-auto size-3.5 shrink-0 opacity-60" /> : null}
      </div>
      {!section.slots.length ? <div className="px-3 text-xs text-muted-foreground">No questions in this section</div> : null}
    </div>
  );
});

export const FormNode = memo(function FormNode({ data }: NodeProps<FormNodeT>) {
  const { form, editable, number, active } = data;
  const addItem = useStore((s) => s.addItem);
  const fields = form.items.filter(C.isField);
  const gated = fields.filter((f) => f.logic.trim()).length;
  return (
    <div className={cn("instrument-box h-full w-full rounded-2xl border transition-colors", active ? "border-primary/70 ring-2 ring-primary/15" : "border-border")}>
      <div className={cn("form-grip flex h-[68px] items-center gap-3 px-4", editable && "cursor-grab active:cursor-grabbing")}>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-[12px] font-semibold text-background">{number}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight">{form.label}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            Instrument · {plural(fields.length, "question")}{gated ? ` · ${gated} with branching` : ""}
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

/** Brackets stay in the instrument gutter, even for backward and self references. */
export function BracketEdge({ sourceX, sourceY, targetX, targetY, data, ...rest }: EdgeProps<Edge>) {
  const x = Math.max(sourceX, targetX) + 22 + Number(data?.lane ?? 0) * 12;
  const path = `M ${sourceX} ${sourceY} H ${x} V ${targetY} H ${targetX}`;
  return <g><title>{String(data?.label ?? "Branching condition")}</title>
    <BaseEdge path={path} markerEnd={rest.markerEnd} style={rest.style} interactionWidth={12} />
  </g>;
}

/** Constant-width ribbons denote dependencies, not respondent counts. */
export function SankeyEdge({ sourceX, sourceY, targetX, targetY, data, ...rest }: EdgeProps<Edge>) {
  const direction = targetX >= sourceX ? 1 : -1;
  const bend = Math.max(70, Math.abs(targetX - sourceX) * 0.5);
  const path = `M ${sourceX} ${sourceY} C ${sourceX + direction * bend} ${sourceY}, ${targetX - direction * bend} ${targetY}, ${targetX} ${targetY}`;
  return <g><title>{String(data?.label ?? "Branching condition")}</title>
    <path d={path} className="sankey-ribbon" fill="none" />
    <BaseEdge path={path} markerEnd={rest.markerEnd} style={rest.style} interactionWidth={14} />
  </g>;
}

export const nodeTypes = { item: ItemNode, section: SectionNode, form: FormNode };
export const edgeTypes = { bracket: BracketEdge, sankey: SankeyEdge };
