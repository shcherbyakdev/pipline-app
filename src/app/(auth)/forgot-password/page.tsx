import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  const { expired } = await searchParams;
  const t = await getTranslations("auth.forgot");
  return (
    <div>
      <h1 className="mb-1.5 text-center text-lg font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground mb-6 text-center text-sm">{t("blurb")}</p>
      {expired ? (
        <p className="text-destructive mb-4 text-center text-sm">{t("expired")}</p>
      ) : null}
      <ForgotPasswordForm />
      <p className="text-muted-foreground mt-7 text-center text-sm">
        <Link href="/login" className="text-foreground hover:underline">
          {t("back")}
        </Link>
      </p>
    </div>
  );
}
