import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOptionalUser } from "@/lib/auth/session";
import { afterLogin, safeNextPath } from "@/lib/auth/next-path";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  // Already signed in: nothing to do here (a re-opened confirmation link,
  // a bookmark). Straight to where they were headed.
  if (await getOptionalUser()) redirect(afterLogin(next));
  const nextPath = safeNextPath(next);
  const t = await getTranslations("auth.login");

  return (
    <div>
      {/* The wordmark above already says Booklo — the heading doesn't repeat it. */}
      <h1 className="mb-6 text-center text-lg font-semibold tracking-tight">{t("title")}</h1>
      {error === "auth" ? (
        <p className="text-destructive mb-4 text-center text-sm">{t("expiredLink")}</p>
      ) : null}
      <LoginForm next={nextPath} />
      <p className="text-muted-foreground mt-7 text-center text-sm">
        {t.rich("noAccount", {
          link: (chunks) => (
            <Link href="/signup" className="text-foreground hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}
