import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges, Background, BackgroundVariant, Controls, MiniMap, ReactFlow, useReactFlow, ViewportPortal,
  MarkerType, Panel, type Connection, type Edge, type NodeChange,
} from "@xyflow/react";
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
        id: col.form.id, type: "form", position: { x: col.x, y: 0 }, width: col.w, height: col.h,
        data: { form: col.form, rev, editable, number: k + 1, active: col.form.id === selectedForm },
        draggable: editable, dragHandle: ".form-grip", selectable: false, zIndex: 0,
      });
      for (const section of col.sections) {
        out.push({
          id: section.id, type: "section", parentId: col.form.id,
          position: { x: section.x, y: section.y }, width: section.w, height: section.h,
          data: { section, rev, editable }, selected: section.id === selected,
          draggable: editable && !section.implicit, selectable: !section.implicit,
          dragHandle: ".section-grip", zIndex: 1,
        });
        for (const s of section.slots) {
          out.push({
            id: s.item.id, parentId: section.id, position: { x: s.x - section.x, y: s.y - section.y },
            width: s.w, height: s.h, draggable: editable && !(C.isField(s.item) && s.item.rid),
            selected: s.item.id === selected, zIndex: 2, type: "item",
            data: { slot: s, rev, editable, worst: worst.get(s.item.id), flash: flashId === s.item.id },
          });
        }
      }
    });
    return out;
  }, [layout, rev, editable, selected, selectedForm, worst, flashId]);

  const [nodes, setNodes] = useState<AppNode[]>(layoutNodes);
  useEffect(() => setNodes(layoutNodes), [layoutNodes]);

  const edges = useMemo<Edge[]>(() => layout.branches.map((branch) => {
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
    const y = slot ? slot.y + slot.h / 2 : 120;
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
      y: (section?.y ?? 0) + node.position.y + (node.type === "form" ? 0 : node.type === "section" ? SECTION_H / 2 : (node.height ?? 0) / 2),
    };
  };

  const formIndexAt = (cx: number, id: string) =>
    layout.columns.filter((c) => c.form.id !== id && c.x + c.w / 2 < cx).length;

  const onNodeDrag = (_: unknown, node: AppNode) => {
    const c = centerOf(node);
    if (node.type === "form") {
      const k = formIndexAt(c.x, node.id);
      const others = layout.columns.filter((col) => col.form.id !== node.id);
      const x = k < others.length ? others[k].x - COL_GAP / 2 - 2 : (others.at(-1)?.x ?? 0) + (others.at(-1)?.w ?? 0) + COL_GAP / 2 - 2;
      setHint({ x, y: 0, w: 4, vertical: true, h: 240 });
      return;
    }
    setHint(hintFor(c.x, c.y, node.id)?.hint ?? null);
  };

  const onNodeDragStop = (_: unknown, node: AppNode) => {
    setHint(null);
    const st = useStore.getState();
    const c = centerOf(node);
    if (node.type === "form") {
      const k = formIndexAt(c.x, node.id);
      if (k !== project.forms.findIndex((f) => f.id === node.id)) st.moveForm(node.id, k);
      else setNodes(layoutNodes);
      return;
    }
    const t = hintFor(c.x, c.y, node.id);
    const slot = layout.slotById.get(node.id);
    if (t && slot && !(t.formId === slot.form.id && t.index === slot.index)) st.moveItem(node.id, t.formId, t.index);
    else setNodes(layoutNodes);
  };

  const onConnect = (c: Connection) => {
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
      st.addForm();
      const form = useStore.getState().project!.forms.at(-1)!;
      st.addItem(key, form.id, 0);
    }
  };

  return (
    <div ref={wrap} className={"h-full w-full" + (linking ? " linking" : "")} onDragOver={onDragOver} onDrop={onDrop} onDragLeave={() => setHint(null)}>
      <ReactFlow<AppNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => {
          const st = useStore.getState();
          if (n.type === "form") st.selectForm(n.id);
          else if (n.type === "section" && n.data.section.implicit) st.selectForm(n.data.section.form.id);
          else st.select(n.id);
        }}
        onPaneClick={() => useStore.getState().select(null)}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onConnectStart={() => setLinking(true)}
        onConnectEnd={() => setLinking(false)}
        isValidConnection={(c) => c.source !== c.target && c.targetHandle === "in" && layout.slotById.get(c.source)?.item.kind === "field"}
        nodesDraggable={editable}
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
        <Panel position="top-left" className="flow-legend">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="legend-instrument">Instrument</span><span aria-hidden>›</span>
            <span className="legend-section">Section</span><span aria-hidden>›</span>
            <span className="legend-question">Question</span><span aria-hidden>›</span>
            <span>Response options</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span>┐ Brackets: within instrument</span><span className="legend-section">┐ Purple: between sections</span><span>⌁ Curves: between instruments</span>
          </div>
        </Panel>
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
