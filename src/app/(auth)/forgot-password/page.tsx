import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  const { expired } = await searchParams;
  return (
    <div>
      <h1 className="mb-1.5 text-center text-lg font-semibold tracking-tight">Reset your password</h1>
      <p className="text-muted-foreground mb-6 text-center text-sm">
        We&apos;ll email you a link to set a new one.
      </p>
      {expired ? (
        <p className="text-destructive mb-4 text-center text-sm">
          That reset link was already used or has expired — request a new one.
        </p>
      ) : null}
      <ForgotPasswordForm />
      <p className="text-muted-foreground mt-7 text-center text-sm">
        <Link href="/login" className="text-foreground hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
