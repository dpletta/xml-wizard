import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function plural(n: number, word: string, many?: string) {
  return `${n} ${n === 1 ? word : many ?? word + "s"}`;
}

export function fileStem(name: string) {
  return name.replace(/\.[^.]+$/, "") || "survey";
}
