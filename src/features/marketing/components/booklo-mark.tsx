import { cn } from "@/lib/utils";
import { SITE } from "@/features/marketing/site";

/* Booklo wordmark — "Booklo" with the first letter replaced by a pixel "b" set
   on a 3×4 cell grid: the lit cells draw the letter, the unlit cells stay as
   a faint grid (a calendar), and one bowl cell is lit in the accent (the
   booking). Idea family: letterform-with-a-twist / pixel letters
   (Flashback, TBD on logosystem.co). Sized in em so it tracks the text. */

const COLS = 3;
const ROWS = 4;
const CELL = 1;
const GAP = 0.28;
const W = COLS * CELL + (COLS - 1) * GAP; // 3.56
const H = ROWS * CELL + (ROWS - 1) * GAP; // 4.84
/* Lit cells, [col,row]: stem down col 0 (the ascender), bowl on rows 1–3 so
   it lines up with the x-height of the letters that follow. */
const LIT = new Set(["0,0", "0,1", "0,2", "0,3", "1,1", "2,1", "2,2", "1,3", "2,3"]);
const ACCENT = "2,2";

export function PixelB({ className, accent = "var(--highlight)" }: { className?: string; accent?: string }) {
  const cells = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const k = `${c},${r}`;
      cells.push(
        <rect
          key={k}
          x={c * (CELL + GAP)}
          y={r * (CELL + GAP)}
          width={CELL}
          height={CELL}
          rx={0.22}
          fill={k === ACCENT ? accent : "currentColor"}
          opacity={LIT.has(k) ? 1 : 0.16}
        />,
      );
    }
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      // Height ≈ the b's ascender; width follows the 3:5 grid. Baseline-aligned
      // and nudged down a hair so the foot sits on the text baseline.
      style={{ height: "0.75em", width: `${(0.75 * W) / H}em`, verticalAlign: "baseline", transform: "translateY(0.02em)" }}
      className={cn("inline-block", className)}
      aria-hidden="true"
      focusable="false"
    >
      {cells}
    </svg>
  );
}

/** "Booklo" with the pixel b, set in the landing sans at 600 — full name kept
    for assistive tech. */
export function BookloWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline font-sans font-semibold tracking-[-0.02em]", className)}>
      <span className="sr-only">{SITE.name}</span>
      <span aria-hidden="true" className="inline-flex items-baseline gap-[0.06em]">
        <PixelB />
        <span>{SITE.name.slice(1)}</span>
      </span>
    </span>
  );
}
