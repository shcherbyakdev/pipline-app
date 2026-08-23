"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { checkHandle, type HandleCheck } from "@/features/scheduling/handle-actions";
import { HANDLE_RE, isReservedHandle, normalizeHandle } from "@/features/scheduling/handle";
import { CLAIM, SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";

/* "booklo.co/ your-name [→]" (spec §3.5). Controlled: the hero owns the
   handle so the mockup can mirror it. Checks availability on submit only —
   a public page shouldn't hit the DB on every keystroke. */
export function ClaimBar({
  handle,
  onHandleChange,
  host,
  size = "lg",
  autoFocus = false,
  className,
}: {
  handle: string;
  onHandleChange: (next: string) => void;
  host: string;
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
      const r = await checkHandle(handle);
      if (r.status === "free" || r.status === "error") {
        // A failed check never blocks the claim: onboarding re-checks.
        router.push(`${SITE.links.signup}?handle=${encodeURIComponent(handle)}`);
        if (r.status === "error") setResult(r);
        return;
      }
      setResult(r);
    });
  };

  let status: React.ReactNode = CLAIM.hint;
  let tone = "text-muted-foreground";
  if (result?.status === "invalid") {
    status = handle && isReservedHandle(handle) ? CLAIM.unavailable : CLAIM.hint;
    tone = "text-destructive";
  } else if (result?.status === "taken") {
    const suggestion = result.suggestion;
    status = (
      <>
        {CLAIM.taken(url)}
        {" — "}
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
          "bg-card ring-border focus-within:ring-highlight flex items-center gap-2 rounded-full shadow-sm ring-1 focus-within:ring-2",
          tall ? "py-1.5 pr-1.5 pl-5" : "py-1 pr-1 pl-4",
        )}
      >
        <label htmlFor={id} className="text-foreground shrink-0 font-mono text-sm sm:text-base">
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
          className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent py-2 font-mono text-sm outline-none sm:text-base"
        />
        <button
          type="submit"
          disabled={pending || handle.length < 3}
          aria-label={CLAIM.button}
          className={cn(
            "bg-primary text-primary-foreground inline-flex shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 motion-reduce:transition-none",
            tall ? "size-9 sm:size-10" : "size-8",
          )}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight className="size-4 sm:size-[18px]" aria-hidden="true" />
          )}
        </button>
      </div>
      <p id={`${id}-status`} aria-live="polite" className={cn("mt-2 min-h-5 text-sm", tone)}>
        {status}
      </p>
    </form>
  );
}
