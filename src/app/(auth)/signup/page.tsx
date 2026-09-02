import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { env } from "@/env";
import { getOptionalUser } from "@/lib/auth/session";
import { HANDLE_RE, isReservedHandle, normalizeHandle } from "@/features/scheduling/handle";
import { hostLabel } from "@/lib/booking/url";
import { SignupForm } from "./signup-form";

// ?handle= comes from the landing claim bar (normalised the way the bar
// normalises as you type, so "Anna Studio" pasted into the URL still
// claims anna-studio). Anything still malformed or reserved is dropped
// silently — the plain signup is the fallback, never an error.
export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  if (await getOptionalUser()) redirect("/bookings");
  const { handle: raw } = await searchParams;
  const candidate = typeof raw === "string" ? normalizeHandle(raw).replace(/-+$/, "") : null;
  const handle = candidate && HANDLE_RE.test(candidate) && !isReservedHandle(candidate) ? candidate : null;
  const host = hostLabel(env.NEXT_PUBLIC_APP_URL);
  const t = await getTranslations("auth.signup");

  return (
    <div>
      {/* The wordmark above already says Booklo — the heading doesn't repeat it. */}
      <h1 className="mb-1.5 text-center text-lg font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground mb-6 text-center text-sm">{t("blurb")}</p>
      <SignupForm handle={handle} host={host} />
      <p className="text-muted-foreground mt-7 text-center text-sm">
        {t.rich("haveAccount", {
          link: (chunks) => (
            <Link href="/login" className="text-foreground hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}
