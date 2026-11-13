import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges, Background, BackgroundVariant, Controls, MiniMap, ReactFlow, useReactFlow, ViewportPortal,
  MarkerType, Panel, type Connection, type Edge, type NodeChange,
} from "@xyflow/react";
import { CanvasToolbar } from "./CanvasToolbar";
import { Button } from "./ui/button";
import { C, type Issue } from "@/lib/core";
import { COL_GAP, SECTION_H, computeLayout, dropTarget, worstByItem } from "@/lib/layout";
import { useProject, useStore } from "@/lib/store";
import { edgeTypes, nodeTypes, type AppNode } from "./nodes";

export const KIND_MIME = "application/x-xmlw-kind";

interface Hint {
  x: number;
  y: number;
  w: number;
  vertical?: boolean;
  h?: number;
}

export function Canvas({ issues, dark }: { issues: Issue[]; dark: boolean }) {
  const [project, rev] = useProject();
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.canvasTool);
  const [flowStart, setFlowStart] = useState<string | null>(null);
  const [selectedFlow, setSelectedFlow] = useState<string | null>(null);
  useEffect(() => { setFlowStart(null); }, [tool]);
  const selected = useStore((s) => s.selected);
  const selectedForm = useStore((s) => s.selectedForm);
  const focusTick = useStore((s) => s.focusTick);
  const editable = mode === "design";
  const flow = useReactFlow();
  const [hint, setHint] = useState<Hint | null>(null);
  const [linking, setLinking] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => computeLayout(project, editable), [project, rev, editable]);
  const worst = useMemo(() => worstByItem(issues), [issues]);

  const layoutNodes = useMemo<AppNode[]>(() => {
    const out: AppNode[] = [];
    layout.columns.forEach((col, k) => {
      out.push({
        id: col.form.id, type: "form", position: { x: col.x, y: col.y }, width: col.w, height: col.h,
        data: { form: col.form, rev, editable, number: k + 1, active: col.form.id === selectedForm },
        draggable: editable && tool === "select", dragHandle: ".form-grip", selectable: false, zIndex: 0,
      });
      for (const section of col.sections) {
        out.push({
          id: section.id, type: "section", parentId: col.form.id,
          position: { x: section.x, y: section.y }, width: section.w, height: section.h,
          data: { section, rev, editable }, selected: section.id === selected,
          draggable: editable && tool === "select" && !section.implicit, selectable: !section.implicit,
          dragHandle: ".section-grip", zIndex: 1,
        });
        for (const s of section.slots) {
          out.push({
            id: s.item.id, parentId: section.id, position: { x: s.x - section.x, y: s.y - section.y },
            width: s.w, height: s.h, draggable: editable && tool === "select" && !(C.isField(s.item) && s.item.rid),
            selected: s.item.id === selected, zIndex: 2, type: "item",
            data: { slot: s, rev, editable, worst: worst.get(s.item.id), flash: flashId === s.item.id },
          });
        }
      }
    });
    return out;
  }, [layout, rev, editable, tool, selected, selectedForm, worst, flashId]);

  const [nodes, setNodes] = useState<AppNode[]>(layoutNodes);
  useEffect(() => setNodes(layoutNodes), [layoutNodes]);

  const branches = useMemo<Edge[]>(() => layout.branches.map((branch) => {
    const { source, target, code, crossInstrument } = branch;
    const right = layout.columnById.get(target.form.id)!.x >= layout.columnById.get(source.form.id)!.x;
    const hot = selected === source.item.id || selected === target.item.id
      || selected === source.sectionId || selected === target.sectionId
      || selectedForm === source.form.id || selectedForm === target.form.id;
    const crossSection = !crossInstrument && source.sectionId !== target.sectionId;
    const side = crossInstrument && !right ? "left" : "right";
    return {
      id: branch.id, source: source.item.id, target: target.item.id,
      sourceHandle: code === null ? `out-${side}` : `choice-${side}:${code}`,
      targetHandle: crossInstrument && right ? "in-left" : "in-right",
      type: crossInstrument ? "sankey" : "bracket",
      data: { lane: branch.lane, label: branch.label },
      className: `branch ${crossInstrument ? "sankey" : crossSection ? "bracket cross-section" : "bracket"}${hot ? " hot" : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed, color: crossSection ? "var(--flow-section)" : "var(--flow-link)", width: 12, height: 12 },
      selectable: false, focusable: true, ariaLabel: `Show ${C.stripHtml(target.item.label)} if ${branch.label}`,
      zIndex: hot ? 5 : 4,
    };
  }), [layout, selected, selectedForm]);

  const edges: Edge[] = [...branches, ...(project.workspace?.flows ?? []).map((line) => ({
    id: line.id, source: line.source, target: line.target, sourceHandle: "flow-out", targetHandle: "flow-in",
    type: "smoothstep", label: line.label, selected: selectedFlow === line.id,
    style: { stroke: "var(--flow-link)", strokeWidth: selectedFlow === line.id ? 3 : 2, strokeDasharray: "7 5" },
    labelStyle: { fill: "var(--foreground)", fontSize: 12 }, labelBgStyle: { fill: "var(--surface)" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--flow-link)" },
    zIndex: 6, ariaLabel: "Planning flow: " + line.label,
  }))];
  const selectedLine = project.workspace?.flows.find((f) => f.id === selectedFlow);

  const onNodesChange = useCallback((changes: NodeChange<AppNode>[]) => {
    const keep = changes.filter((c) => c.type === "position" || c.type === "dimensions");
    if (keep.length) setNodes((ns) => applyNodeChanges(keep, ns));
  }, []);

  // Frame the survey when a project opens; later changes keep the person's view.
  const fitted = useRef<unknown>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fitted.current === project) return;
    fitted.current = project;
    setTimeout(() => {
      const width = wrap.current?.clientWidth ?? 900;
      const total = layout.columns.reduce((sum, col) => sum + col.w + COL_GAP, -COL_GAP);
      // Show every instrument side by side when that keeps the text readable; otherwise start at the first.
      const zoom = Math.max(0.75, Math.min(1, (width - 64) / total));
      const x = total * zoom < width ? (width - total * zoom) / 2 : 32;
      void flow.setViewport({ x, y: 92, zoom }, { duration: 300 });
    }, 50);
  }, [project, layout, flow]);

  // Bring a question into view when something asks for it (search, outline, problems, a new card).
  useEffect(() => {
    if (!focusTick) return;
    const st = useStore.getState();
    const slot = st.selected ? layout.slotById.get(st.selected) : null;
    const col = slot ? layout.columnById.get(slot.form.id) : st.selectedForm ? layout.columnById.get(st.selectedForm) : null;
    if (!col) return;
    const x = col.x + (slot ? slot.x + slot.w / 2 : col.w / 2);
    const y = col.y + (slot ? slot.y + slot.h / 2 : 120);
    flow.setCenter(x, y, { zoom: Math.max(flow.getZoom(), 0.85), duration: 450 });
    if (slot) {
      setFlashId(slot.item.id);
      const t = setTimeout(() => setFlashId(null), 1200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  const hintFor = (cx: number, cy: number, movingId: string | null): { hint: Hint; formId: string; index: number } | null => {
    const t = dropTarget(layout, cx, cy, movingId);
    if (!t) return null;
    return { hint: { x: t.x + 10, y: t.lineY - 2, w: t.w - 20 }, formId: t.form.id, index: t.index };
  };

  const centerOf = (node: AppNode) => {
    const section = node.parentId ? layout.sectionById.get(node.parentId) : null;
    const col = layout.columnById.get(section?.form.id ?? node.parentId ?? "");
    return {
      x: (col?.x ?? 0) + (section?.x ?? 0) + node.position.x + (node.width ?? 0) / 2,
      y: (col?.y ?? 0) + (section?.y ?? 0) + node.position.y + (node.type === "form" ? 0 : node.type === "section" ? SECTION_H / 2 : (node.height ?? 0) / 2),
    };
  };

  const onNodeDrag = (_: unknown, node: AppNode) => {
    if (node.type === "form") { setHint(null); return; }
    const c = centerOf(node);
    setHint(hintFor(c.x, c.y, node.id)?.hint ?? null);
  };

  const onNodeDragStop = (_: unknown, node: AppNode) => {
    setHint(null);
    const st = useStore.getState();
    const c = centerOf(node);
    if (node.type === "form") {
      st.positionForm(node.id, node.position);
      return;
    }
    const t = hintFor(c.x, c.y, node.id);
    const slot = layout.slotById.get(node.id);
    if (t && slot && !(t.formId === slot.form.id && t.index === slot.index)) st.moveItem(node.id, t.formId, t.index);
    else setNodes(layoutNodes);
  };

  const onConnect = (c: Connection) => {
    if (c.sourceHandle === "flow-out" && c.targetHandle === "flow-in") { useStore.getState().addFlow(c.source, c.target); return; }
    const code = c.sourceHandle?.startsWith("choice-right:") ? c.sourceHandle.slice("choice-right:".length) : null;
    useStore.getState().link(c.source, code, c.target);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!editable || !e.dataTransfer.types.includes(KIND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setHint(hintFor(p.x, p.y, null)?.hint ?? null);
  };

  const onDrop = (e: React.DragEvent) => {
    const key = e.dataTransfer.getData(KIND_MIME);
    setHint(null);
    if (!editable || !key) return;
    e.preventDefault();
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const t = hintFor(p.x, p.y, null);
    const st = useStore.getState();
    if (t) st.addItem(key, t.formId, t.index);
    else {
      st.addForm(p);
      const form = useStore.getState().project!.forms.at(-1)!;
      st.addItem(key, form.id, 0);
    }
  };

  const place = (event: React.MouseEvent, node?: AppNode) => {
    const st = useStore.getState();
    if (tool === "instrument") {
      st.addForm(flow.screenToFlowPosition({x: event.clientX, y: event.clientY})); st.setCanvasTool("select"); return;
    }
    if (tool === "section") {
      const p = flow.screenToFlowPosition({x: event.clientX, y: event.clientY}), target = hintFor(p.x, p.y, null);
      if (!target) { st.say("Choose a spot inside an instrument for this section."); return; }
      st.addItem("section", target.formId, target.index); st.setCanvasTool("select"); return;
    }
    if (tool === "connect" && node) {
      const id = node.type === "section" && node.data.section.implicit ? node.data.section.form.id : node.id;
      if (!flowStart) { setFlowStart(id); st.say("Choose the destination for this flow line."); }
      else { st.addFlow(flowStart, id); setFlowStart(null); }
      return;
    }
    setSelectedFlow(null);
    if (!node) st.select(null);
    else if (node.type === "form") st.selectForm(node.id);
    else if (node.type === "section" && node.data.section.implicit) st.selectForm(node.data.section.form.id);
    else st.select(node.id);
  };

  return (
    <div ref={wrap} className={"h-full w-full" + (linking ? " linking" : "")} onDragOver={onDragOver} onDrop={onDrop} onDragLeave={() => setHint(null)}>
      <ReactFlow<AppNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(e, n) => place(e, n)}
        onPaneClick={(e) => place(e)}
        onEdgeClick={(_, edge) => {
          if (project.workspace?.flows.some((f) => f.id === edge.id)) { setSelectedFlow(edge.id); useStore.getState().select(null); }
          else useStore.getState().reveal(edge.target);
        }}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onConnectStart={() => setLinking(true)}
        onConnectEnd={() => setLinking(false)}
        isValidConnection={(c) => c.source !== c.target && (c.sourceHandle === "flow-out" ? c.targetHandle === "flow-in" : c.targetHandle === "in" && layout.slotById.get(c.source)?.item.kind === "field")}
        nodesDraggable={editable && tool === "select"}
        nodesConnectable={editable}
        elementsSelectable
        nodeDragThreshold={4}
        connectionRadius={24}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        minZoom={0.15}
        maxZoom={1.75}
        colorMode={dark ? "dark" : "light"}
        onlyRenderVisibleElements={false}
        proOptions={{ hideAttribution: false }}
        panOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}>
        <Panel position="top-left" className="max-w-[calc(100%-32px)]">
          <CanvasToolbar />
          {flowStart ? <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs">Select a destination to finish the flow line.</p> : null}
        </Panel>
        {selectedLine ? <Panel position="bottom-center" className="canvas-toolbar max-w-sm">
          <label className="text-xs font-medium">Planning flow label
            <input aria-label="Planning flow label" className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
              value={selectedLine.label} onChange={(e) => useStore.getState().mutate((p) => {
                const line = p.workspace?.flows.find((f) => f.id === selectedLine.id); if (line) line.label = e.target.value;
              }, "flow:" + selectedLine.id)} />
          </label>
          <p className="my-2 text-xs text-muted-foreground">Saved in your project file. Configure REDCap survey routing separately.</p>
          <Button size="sm" onClick={() => { useStore.getState().mutate((p) => {
            if (p.workspace) p.workspace.flows = p.workspace.flows.filter((f) => f.id !== selectedLine.id);
          }); setSelectedFlow(null); }}>Delete flow line</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedFlow(null)}>Done</Button>
        </Panel> : null}
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="var(--canvas-dot)" />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap position="bottom-right" pannable zoomable
          nodeColor={(n) => (n.type === "form" ? "transparent" : n.selected ? "var(--primary)" : "var(--border-strong)")}
          nodeStrokeColor={(n) => (n.type === "form" ? "var(--border-strong)" : "transparent")} nodeBorderRadius={6} />
        {hint ? (
          <ViewportPortal>
            <div className="pointer-events-none absolute rounded-full bg-primary shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_22%,transparent)]"
              style={{ transform: `translate(${hint.x}px, ${hint.y}px)`, width: hint.w, height: hint.vertical ? hint.h : 4 }} />
          </ViewportPortal>
        ) : null}
      </ReactFlow>
    </div>
  );
}
