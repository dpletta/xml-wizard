import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, BaseEdge, Controls, Handle, MarkerType, Panel, Position, ReactFlow,
  useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import type { Issue } from "@/lib/core";
import { compactLayout, COMPACT_GAP, COMPACT_W, revealCompact, toggleCompact, type CompactRow } from "@/lib/compact-layout";
import { computeLayout, worstByItem } from "@/lib/layout";
import { useProject, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

type RowNode = Node<{ row: CompactRow; active: boolean; warning: boolean; activate: (id: string) => void }, "compact">;
const CompactNode = memo(function CompactNode({ data }: NodeProps<RowNode>) {
  const { row, active, warning } = data;
  return <div className="relative h-full w-full">
    <Handle id="in-left" type="target" position={Position.Left} style={{ top: "40%", opacity: 0 }} isConnectable={false} />
    <Handle id="in-right" type="target" position={Position.Right} style={{ top: "40%", opacity: 0 }} isConnectable={false} />
    <Handle id="out-left" type="source" position={Position.Left} style={{ top: "65%", opacity: 0 }} isConnectable={false} />
    <Handle id="out-right" type="source" position={Position.Right} style={{ top: "65%", opacity: 0 }} isConnectable={false} />
    <button type="button" onClick={() => data.activate(row.id)}
      aria-expanded={row.kind === "field" ? undefined : row.open}
      title={`${row.label}\n${row.detail}`}
      className={cn("nodrag nopan flex h-full w-full items-center gap-2 rounded-lg border px-3 text-left shadow-sm focus-visible:outline-2 focus-visible:outline-primary",
        row.kind === "form" ? "border-blue-400/30 bg-[#365b86] text-white" :
          row.kind === "section" ? "border-violet-400/30 bg-violet-400/10 text-foreground" : "border-border bg-surface text-foreground hover:border-primary",
        active && "ring-2 ring-primary ring-offset-2 ring-offset-background")}>
      {row.kind !== "field" ? (row.open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />) : null}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-xs font-semibold", row.kind === "section" && "text-[11px]")}>{row.label}</span>
        <span className={cn("block truncate text-[10px]", row.kind === "form" ? "text-blue-100" : "text-muted-foreground")}>{row.detail}</span>
      </span>
      {warning ? <TriangleAlert className="size-3.5 shrink-0 text-warn" aria-label="Has a problem" /> : null}
    </button>
  </div>;
});
const nodeTypes = { compact: CompactNode };

function CompactEdge({ sourceX, sourceY, targetX, targetY, data, markerEnd, style }: EdgeProps<Edge>) {
  const sameColumn = !!data?.sameColumn;
  const gutter = Math.max(sourceX, targetX) + 18 + Number(data?.lane ?? 0) * 10;
  const direction = targetX >= sourceX ? 1 : -1;
  const bend = Math.max(40, Math.abs(targetX - sourceX) / 2);
  const path = sameColumn ? `M ${sourceX} ${sourceY} H ${gutter} V ${targetY} H ${targetX}` :
    `M ${sourceX} ${sourceY} C ${sourceX + direction * bend} ${sourceY}, ${targetX - direction * bend} ${targetY}, ${targetX} ${targetY}`;
  return <g><title>{String(data?.label ?? "Branching logic")}</title>
    <BaseEdge path={path} markerEnd={markerEnd} style={style}
      label={Number(data?.count) > 1 ? String(data?.count) : undefined}
      labelX={sameColumn ? gutter : (sourceX + targetX) / 2} labelY={(sourceY + targetY) / 2}
      labelStyle={{ fill: "var(--foreground)", fontSize: 10 }} labelBgStyle={{ fill: "var(--surface)" }} />
  </g>;
}
const edgeTypes = { compact: CompactEdge };

export function CompactMap({ issues, dark }: { issues: Issue[]; dark: boolean }) {
  const [project, rev] = useProject();
  const open = useStore((s) => s.compactOpen);
  const selected = useStore((s) => s.selected);
  const selectedForm = useStore((s) => s.selectedForm);
  const focusTick = useStore((s) => s.focusTick);
  const wrap = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  const [columns, setColumns] = useState(2);
  const [arrows, setArrows] = useState(true);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const layout = useMemo(() => computeLayout(project, false), [project, rev]);
  const compact = useMemo(() => compactLayout(layout, new Set(open), columns, project.workspace?.flows), [layout, open, columns]);
  const worst = useMemo(() => worstByItem(issues), [issues]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setColumns(Math.max(1, Math.min(3, Math.floor((el.clientWidth - 32 + COMPACT_GAP) / (COMPACT_W + COMPACT_GAP))))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Both layouts share selection; search and the outline reveal hidden questions.
  useEffect(() => {
    const id = useStore.getState().selected;
    if (!id) return;
    useStore.getState().setCompactOpen(revealCompact(layout, useStore.getState().compactOpen, id));
    setPendingFocus(id);
    // Only explicit navigation (or switching to this view) unfolds a section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  useEffect(() => {
    if (!pendingFocus) return;
    const row = compact.byId.get(pendingFocus);
    if (!row) return;
    const timer = setTimeout(() => {
      void flow.setCenter(row.x + row.w / 2, row.y + row.h / 2, { zoom: Math.max(0.85, flow.getZoom()), duration: 250 });
      setPendingFocus(null);
    }, 80);
    return () => clearTimeout(timer);
  }, [compact, pendingFocus, flow]);

  const activate = (id: string) => {
    const row = compact.byId.get(id)!;
    const st = useStore.getState();
    if (row.kind === "field") { st.select(id); return; }
    if (row.kind === "form") st.selectForm(id);
    else if (!row.implicit) st.select(id);
    const next = toggleCompact(layout, open, id);
    const after = compactLayout(layout, new Set(next), columns).byId.get(id)!;
    const viewport = flow.getViewport();
    st.setCompactOpen(next);
    // Folding earlier siblings must not move the clicked header off screen.
    void flow.setViewport({ ...viewport, y: viewport.y + (row.y - after.y) * viewport.zoom });
  };
  const nodes: RowNode[] = compact.rows.map((row) => ({
    id: row.id, type: "compact", position: { x: row.x, y: row.y }, width: row.w, height: row.h,
    data: { row, active: row.id === selected || row.id === selectedForm, warning: worst.has(row.id), activate },
    draggable: false, selectable: false, focusable: false, style: { pointerEvents: "all" },
  }));
  const edges: Edge[] = arrows ? compact.edges.map((edge) => {
    const source = compact.byId.get(edge.source)!;
    const target = compact.byId.get(edge.target)!;
    const sameColumn = Math.abs(source.x - target.x) < COMPACT_W;
    const right = target.x >= source.x;
    const hot = edge.source === selected || edge.target === selected || edge.source === selectedForm || edge.target === selectedForm;
    const label = edge.count > 1 ? `${edge.count} branching references between these groups` : edge.label;
    return { id: edge.id, source: edge.source, target: edge.target, type: "compact",
      sourceHandle: sameColumn || right ? "out-right" : "out-left", targetHandle: sameColumn || !right ? "in-right" : "in-left",
      data: { ...edge, label, sameColumn }, ariaLabel: label, selectable: false,
      style: { stroke: "var(--flow-link)", strokeWidth: hot ? 2.5 : 1.5, opacity: hot ? 1 : 0.75, strokeDasharray: edge.planning ? "7 5" : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--flow-link)", width: 14, height: 14 },
    };
  }) : [];

  return <div ref={wrap} className="h-full w-full">
    <ReactFlow<RowNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
      defaultViewport={{ x: 24, y: 100, zoom: 0.9 }} minZoom={0.15} maxZoom={1.8}
      deleteKeyCode={null} colorMode={dark ? "dark" : "light"} panOnScroll zoomOnDoubleClick={false}
      onPaneClick={() => useStore.getState().select(null)}>
      <Panel position="top-left" className="flow-legend max-w-[calc(100%-24px)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-2 font-semibold">Accordion map</span>
          <Button size="sm" onClick={() => useStore.getState().setCompactOpen(layout.columns.flatMap((col) => [col.form.id, ...col.sections.map((s) => s.id)]))}>Expand all</Button>
          <Button size="sm" onClick={() => { useStore.getState().setCompactOpen([]); void flow.setViewport({ x: 24, y: 100, zoom: 0.9 }); }}>Collapse all</Button>
          <Button size="sm" variant={arrows ? "soft" : "secondary"} aria-pressed={arrows} onClick={() => setArrows(!arrows)}>Arrows</Button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Open an instrument, then a section. Select a question to inspect it; use Canvas to edit.</p>
      </Panel>
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="var(--canvas-dot)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  </div>;
}
