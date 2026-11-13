import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { C, type Field } from "@/lib/core";
import { useStore } from "@/lib/store";
import { Button } from "./ui/button";
import { Input, Textarea } from "./ui/fields";

function parseList(text: string) {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const coded = lines.every((s) => /^-?[A-Za-z0-9_.]+\s*,\s*\S/.test(s));
  return lines.map((s, k) => {
    if (!coded) return { code: String(k + 1), label: s };
    const at = s.indexOf(",");
    return { code: s.slice(0, at).trim(), label: s.slice(at + 1).trim() };
  });
}

export function ChoiceEditor({ field }: { field: Field }) {
  const mutate = useStore((s) => s.mutate);
  const [bulk, setBulk] = useState<string | null>(null);
  const [focusLast, setFocusLast] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusLast) return;
    const inputs = list.current?.querySelectorAll<HTMLInputElement>("input[data-answer]");
    inputs?.[inputs.length - 1]?.focus();
  }, [focusLast]);

  const add = () => {
    mutate(() => { field.choices.push({ code: C.nextCode(field.choices), label: "" }); });
    setFocusLast((n) => n + 1);
  };

  return (
    <div>
      <div ref={list} className="space-y-1.5">
        {field.choices.map((c, k) => (
          <div key={k} className="flex items-center gap-1.5">
            <Input value={c.code} aria-label="Code" title="The value stored in your data" spellCheck={false}
              className="w-14 shrink-0 px-1.5 text-center font-mono text-xs"
              onChange={(e) => mutate(() => { c.code = e.target.value.trim(); }, `code:${field.id}:${k}`)} />
            <Input data-answer value={c.label} aria-label="Answer" placeholder={"Answer " + (k + 1)}
              onChange={(e) => mutate(() => { c.label = e.target.value; }, `choice:${field.id}:${k}`)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
            <button aria-label="Remove this answer" title="Remove this answer" disabled={field.choices.length < 2}
              onClick={() => mutate(() => { field.choices.splice(k, 1); })}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={add}>
          <Plus className="size-3.5" /> Add an answer
        </button>
        <button className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => setBulk(bulk == null ? field.choices.map((c) => c.label).join("\n") : null)}>
          Paste a list
        </button>
      </div>
      {bulk != null ? (
        <div className="mt-2 space-y-2">
          <Textarea autoFocus rows={5} placeholder="One answer per line" value={bulk} onChange={(e) => setBulk(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={() => {
              const next = parseList(bulk);
              if (next.length) mutate(() => { field.choices = next; });
              setBulk(null);
            }}>Use this list</Button>
            <Button variant="ghost" size="sm" onClick={() => setBulk(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}
      <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
        The small box is the code saved in your data. Drag an answer on the canvas onto another question to branch on it.
      </p>
    </div>
  );
}
