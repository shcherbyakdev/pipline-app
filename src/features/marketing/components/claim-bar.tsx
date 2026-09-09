"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { checkHandle, type HandleCheck } from "@/features/scheduling/handle-actions";
import { HANDLE_RE, isReservedHandle, normalizeHandle } from "@/features/scheduling/handle";
import { CLAIM, SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";

/* "booklo.co/ your-studio [Claim →]" (spec §3.5), drawn as one quiet
   field: a hairline, the address prefix in grey, the ink submit inside.
   The page's one action. Controlled: the hero owns the handle. Checks
   availability on submit only; a public page shouldn't hit the DB on
   every keystroke. */
export function ClaimBar({
  handle,
  onHandleChange,
  host,
  idleNote,
  size = "lg",
  autoFocus = false,
  className,
}: {
  handle: string;
  onHandleChange: (next: string) => void;
  host: string;
  /** Shown under the bar while it's empty; the format
      hint takes its place once the person is typing. */
  idleNote?: string;
  size?: "lg" | "md";
  autoFocus?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const id = React.useId();
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<HandleCheck | null>(null);
  const url = `${host}/${handle}`;
  const complete = HANDLE_RE.test(handle) && !isReservedHandle(handle);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!complete) {
      setResult({ status: "invalid" });
      return;
    }
    startTransition(async () => {
      // No suggestion lookups here: the bar only needs free/taken;
      // onboarding offers alternatives.
      const r = await checkHandle(handle, { suggest: false });
      if (r.status === "free" || r.status === "error") {
        // A failed check never blocks the claim: onboarding re-checks.
        router.push(`${SITE.links.signup}?handle=${encodeURIComponent(handle)}`);
        if (r.status === "error") setResult(r);
        return;
      }
      setResult(r);
    });
  };

  // The early-access note stays until typing starts: focusing an empty
  // field is the moment of commitment, not the moment for rules.
  let status: React.ReactNode = handle ? CLAIM.hint : (idleNote ?? CLAIM.hint);
  let tone = "text-muted-foreground";
  if (result?.status === "invalid") {
    status = handle && isReservedHandle(handle) ? CLAIM.unavailable : CLAIM.hint;
    tone = "text-destructive";
  } else if (result?.status === "taken") {
    const suggestion = result.suggestion;
    status = (
      <>
        {CLAIM.taken(url)}
        {". "}
        {suggestion ? (
          <>
            {CLAIM.tryPrefix}
            <button
              type="button"
              className="text-foreground underline underline-offset-2"
              onClick={() => {
                onHandleChange(suggestion);
                setResult(null);
              }}
            >
              {suggestion}
            </button>
          </>
        ) : (
          CLAIM.tryAnother
        )}
      </>
    );
    tone = "text-destructive";
  } else if (result?.status === "error") {
    status = CLAIM.checkFailed;
  }

  const tall = size === "lg";

  return (
    <form onSubmit={submit} className={cn("w-full", className)} noValidate>
      <div
        className={cn(
          "bg-card ring-input focus-within:ring-ring flex items-center gap-1.5 rounded-full ring-1 transition-[box-shadow] duration-200 ease-strong focus-within:ring-2",
          tall ? "py-1 pr-1 pl-4" : "py-1 pr-1 pl-3.5",
        )}
      >
        <label htmlFor={id} className="text-muted-foreground shrink-0 text-[15px]">
          {host}/
        </label>
        <input
          id={id}
          value={handle}
          onChange={(e) => {
            onHandleChange(normalizeHandle(e.target.value));
            setResult(null);
          }}
          placeholder={CLAIM.placeholder}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="url"
          maxLength={50}
          autoFocus={autoFocus}
          aria-label="Your page name"
          aria-describedby={`${id}-status`}
          aria-invalid={result?.status === "invalid" || result?.status === "taken" || undefined}
          className="text-card-foreground placeholder:text-subtle min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none"
        />
        {/* Always live: a short or bad name submits into the hint below
            rather than greying the page's one action out. */}
        <button
          type="submit"
          disabled={pending}
          className={cn(
            "bg-primary text-primary-foreground focus-visible:ring-ring inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full text-[14px] font-medium transition-[background-color,transform,opacity] duration-[160ms] ease-strong outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-card [@media(hover:hover)_and_(pointer:fine)]:hover:bg-primary/85 active:scale-[0.97] disabled:opacity-60 motion-reduce:transition-none",
            tall ? "h-9 px-4" : "h-8 px-3.5",
          )}
        >
          {CLAIM.button}
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
      <p id={`${id}-status`} aria-live="polite" className={cn("mt-2.5 min-h-5 text-[14px]", tone)}>
        {status}
      </p>
    </form>
  );
}
