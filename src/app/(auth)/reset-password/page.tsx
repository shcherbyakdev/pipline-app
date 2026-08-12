import { requireUser } from "@/lib/auth/session";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage() {
  await requireUser();

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Set a new password
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          You&apos;re signed in via your reset link — choose a new password.
        </p>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
