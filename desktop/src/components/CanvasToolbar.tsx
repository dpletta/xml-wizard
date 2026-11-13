import { MousePointer2, PanelTop, Rows3, Plus, Spline, ArrowRight } from 'lucide-react';
import { C } from '@/lib/core';
import { lookFor } from '@/lib/kinds';
import { useStore, type CanvasTool } from '@/lib/store';
import { Button } from './ui/button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from './ui/overlays';
export function CanvasToolbar() {
  const tool = useStore((s) => s.canvasTool);
  const setTool = useStore((s) => s.setCanvasTool);
  const tools: [CanvasTool, string, typeof Plus][] = [['select', 'Select', MousePointer2], ['instrument', 'Instrument', PanelTop], ['section', 'Section', Rows3], ['connect', 'Flow line', Spline]];
  return <div className="canvas-toolbar nodrag nopan">
    <div role="toolbar" aria-label="Canvas tools" className="flex flex-wrap items-center gap-1">
      {tools.map(([key, label, Icon]) => <Button key={key} size="sm" variant={tool === key ? 'primary' : 'ghost'} aria-pressed={tool === key} onClick={() => setTool(key)}><Icon />{label}</Button>)}
      <Menu><MenuTrigger asChild><Button size="sm"><Plus />Question</Button></MenuTrigger>
        <MenuContent className="thin-scroll max-h-80 overflow-y-auto"><MenuLabel>Add to the selected instrument</MenuLabel>
          {C.KINDS.filter((k) => k.key !== 'section').map((k) => { const Icon = lookFor(k.key).icon; return <MenuItem key={k.key} icon={<Icon />} onSelect={() => useStore.getState().addItem(k.key)}>{k.label}</MenuItem>; })}
        </MenuContent>
      </Menu>
    </div>
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground" role="status"><ArrowRight className="size-3.5 shrink-0" />
      {tool === 'instrument' ? 'Click an empty spot to place an instrument. Esc cancels.' : tool === 'section' ? 'Click inside an instrument to insert a section. Esc cancels.' : tool === 'connect' ? 'Connect the blue handles, or click two elements. Flow lines are planning notes, not REDCap rules.' : 'Drag question types from the sidebar. Drag an answer onto a question to add branching.'}
    </p>
  </div>;
}
