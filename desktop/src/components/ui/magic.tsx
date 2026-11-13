/* Small decorative effects in the style of Magic UI (magicui.design, MIT), written without CSS
   filters so they look the same in every webview and stay cheap to paint. */
import { useRef } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/utils";

/** A soft light that follows the pointer across a card, plus a matching glow on its border. */
export function MagicCard({ className, children, ...rest }: Omit<HTMLMotionProps<"button">, "children"> & { children: React.ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", e.clientX - r.left + "px");
    el.style.setProperty("--my", e.clientY - r.top + "px");
  };
  return (
    <motion.button ref={ref} onPointerMove={move} className={cn("magic-card group relative isolate overflow-hidden", className)} {...rest}>
      <span aria-hidden className="magic-card-light" />
      <span aria-hidden className="magic-card-edge" />
      {children}
    </motion.button>
  );
}

/** A streak of light that travels around the border of its (relative, rounded) parent. */
export function BorderBeam({ duration = 7, delay = 0 }: { duration?: number; delay?: number }) {
  return <span aria-hidden className="border-beam" style={{ animationDuration: duration + "s", animationDelay: delay + "s" }} />;
}

/** Text with a slow highlight sweeping across it. */
export function ShinyText({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("shiny-text", className)}>{children}</span>;
}

/** A soft round glow drawn with a gradient (no blur filter, so it never shows a hard edge). */
export function Glow({ className, strength = 14, style }: { className?: string; strength?: number; style?: React.CSSProperties }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute rounded-full", className)}
      style={{ background: `radial-gradient(closest-side, ${tint(strength)}, ${tint(strength * 0.45)} 45%, ${tint(strength * 0.12)} 75%, transparent)`, ...style }} />
  );
}

function tint(percent: number) {
  return `color-mix(in srgb, var(--primary) ${percent.toFixed(2)}%, transparent)`;
}
