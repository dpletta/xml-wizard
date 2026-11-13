import {
  AlignLeft, AtSign, Calendar, CircleDot, Hash, Heading, ListChecks, Pilcrow, Sigma, SlidersHorizontal,
  SquareChevronDown, ToggleLeft, Type, Upload, Binary, CircleHelp, type LucideIcon,
} from "lucide-react";
import { C, type Item } from "./core";

export interface KindLook {
  icon: LucideIcon;
  /** Tailwind classes for the small icon tile. */
  tile: string;
}

const tiles = {
  text: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
  number: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  date: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  choice: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  yesno: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  calc: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  layout: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const LOOKS: Record<string, KindLook> = {
  text: { icon: Type, tile: tiles.text },
  notes: { icon: AlignLeft, tile: tiles.text },
  integer: { icon: Hash, tile: tiles.number },
  number: { icon: Binary, tile: tiles.number },
  date: { icon: Calendar, tile: tiles.date },
  yesno: { icon: ToggleLeft, tile: tiles.yesno },
  truefalse: { icon: ToggleLeft, tile: tiles.yesno },
  radio: { icon: CircleDot, tile: tiles.choice },
  dropdown: { icon: SquareChevronDown, tile: tiles.choice },
  checkbox: { icon: ListChecks, tile: tiles.choice },
  slider: { icon: SlidersHorizontal, tile: tiles.number },
  email: { icon: AtSign, tile: tiles.text },
  calc: { icon: Sigma, tile: tiles.calc },
  file: { icon: Upload, tile: tiles.layout },
  descriptive: { icon: Pilcrow, tile: tiles.layout },
  section: { icon: Heading, tile: tiles.layout },
};

export function lookFor(key: string): KindLook {
  return LOOKS[key] ?? { icon: CircleHelp, tile: tiles.layout };
}

export function lookOf(item: Item): KindLook & { label: string } {
  const kind = C.kindOf(item);
  return { ...lookFor(kind.key), label: C.isField(item) && item.rid ? "Record ID" : kind.label };
}
