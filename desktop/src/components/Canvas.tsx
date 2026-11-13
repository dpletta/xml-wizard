import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges, Background, BackgroundVariant, Controls, MiniMap, ReactFlow, useReactFlow, ViewportPortal,
  type Connection, type Edge, type NodeChange,
} from "@xyflow/react";
import { C, type Field, type Issue } from "@/lib/core";
import { COL_GAP, COL_W, computeLayout, dependentsOf, dropTarget, worstByItem } from "@/lib/layout";
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
        id: col.form.id, type: "form", position: { x: col.x, y: 0 }, width: COL_W, height: col.h,
        data: { form: col.form, rev, editable, number: k + 1, active: col.form.id === selectedForm },
        draggable: editable, dragHandle: ".form-grip", selectable: false, zIndex: 0,
      });
      for (const s of col.slots) {
        const base = {
          id: s.item.id, parentId: col.form.id, position: { x: s.x, y: s.y }, width: s.w, height: s.h,
          draggable: editable && !(C.isField(s.item) && s.item.rid), selected: s.item.id === selected, zIndex: 1,
        };
        if (C.isField(s.item)) {
          out.push({ ...base, type: "item", data: { slot: s, rev, editable, worst: worst.get(s.item.id), flash: flashId === s.item.id } });
        } else {
          out.push({ ...base, type: "section", data: { slot: s, rev, editable } });
        }
      }
    });
    return out;
  }, [layout, rev, editable, selected, selectedForm, worst, flashId]);

  const [nodes, setNodes] = useState<AppNode[]>(layoutNodes);
  useEffect(() => setNodes(layoutNodes), [layoutNodes]);

  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = [];
    const sel = selected ? layout.slotById.get(selected) : null;
    for (const col of layout.columns) {
      for (const s of col.slots) {
        if (!s.parentId) continue;
        const hot = selected === s.item.id || selected === s.parentId;
        out.push({
          id: "t:" + s.item.id, source: s.parentId, sourceHandle: "tree", target: s.item.id, targetHandle: "in",
          type: "elbow", className: hot ? "tree hot" : "tree", selectable: false, focusable: false, zIndex: hot ? 3 : 0,
        });
      }
    }
    if (sel && C.isField(sel.item)) {
      const me = sel.item;
      const dep = (from: Field, to: Field) => {
        const a = layout.slotById.get(from.id);
        const b = layout.slotById.get(to.id);
        if (!a || !b || b.parentId === from.id) return;
        const right = layout.columnById.get(b.form.id)!.x > layout.columnById.get(a.form.id)!.x;
        out.push({
          id: `d:${from.id}:${to.id}`, source: from.id, sourceHandle: "any", target: to.id, targetHandle: right ? "in" : "in-r",
          className: "dep", selectable: false, focusable: false, zIndex: 4,
        });
      };
      const seen = new Set<string>();
      for (const r of C.logicRefs(me.logic || "")) {
        const hit = layout.index[r.name];
        if (hit && hit.field !== me && !seen.has(hit.field.id)) { seen.add(hit.field.id); dep(hit.field, me); }
      }
      for (const d of dependentsOf(project, me)) dep(me, d);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, selected, rev]);

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
      const total = layout.columns.length * (COL_W + COL_GAP) - COL_GAP;
      // Show every instrument side by side when that keeps the text readable; otherwise start at the first.
      const zoom = Math.max(0.75, Math.min(1, (width - 64) / total));
      const x = total * zoom < width ? (width - total * zoom) / 2 : 32;
      void flow.setViewport({ x, y: 24, zoom }, { duration: 300 });
    }, 50);
  }, [project, layout, flow]);

  // Bring a question into view when something asks for it (search, outline, problems, a new card).
  useEffect(() => {
    if (!focusTick) return;
    const st = useStore.getState();
    const slot = st.selected ? layout.slotById.get(st.selected) : null;
    const col = slot ? layout.columnById.get(slot.form.id) : st.selectedForm ? layout.columnById.get(st.selectedForm) : null;
    if (!col) return;
    const x = col.x + (slot ? slot.x + slot.w / 2 : COL_W / 2);
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
    return { hint: { x: t.x + 10, y: t.lineY - 2, w: COL_W - 20 }, formId: t.form.id, index: t.index };
  };

  const centerOf = (node: AppNode) => {
    const col = node.parentId ? layout.columnById.get(node.parentId) : null;
    return {
      x: (col ? col.x : 0) + node.position.x + (node.width ?? 0) / 2,
      y: node.position.y + (node.type === "form" ? 0 : (node.height ?? 0) / 2),
    };
  };

  const formIndexAt = (cx: number, id: string) =>
    layout.columns.filter((c) => c.form.id !== id && c.x + COL_W / 2 < cx).length;

  const onNodeDrag = (_: unknown, node: AppNode) => {
    const c = centerOf(node);
    if (node.type === "form") {
      const k = formIndexAt(c.x, node.id);
      const others = layout.columns.filter((col) => col.form.id !== node.id);
      const x = k < others.length ? others[k].x - COL_GAP / 2 - 2 : (others[others.length - 1]?.x ?? 0) + COL_W + COL_GAP / 2 - 2;
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
    const code = c.sourceHandle && c.sourceHandle.startsWith("c:") ? c.sourceHandle.slice(2) : null;
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
          else st.select(n.id);
        }}
        onPaneClick={() => useStore.getState().select(null)}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onConnectStart={() => setLinking(true)}
        onConnectEnd={() => setLinking(false)}
        isValidConnection={(c) => c.source !== c.target && c.targetHandle === "in"}
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
        onlyRenderVisibleElements={nodes.length > 400}
        proOptions={{ hideAttribution: false }}
        panOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}>
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
