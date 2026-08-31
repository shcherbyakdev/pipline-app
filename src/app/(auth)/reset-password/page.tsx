import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { RECOVERY_COOKIE } from "@/lib/auth/next-path";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage() {
  await requireUser();
  // Reachable only through a recovery link (the proof /auth/confirm set);
  // updatePassword checks it again on submit.
  if (!(await cookies()).get(RECOVERY_COOKIE)) redirect("/forgot-password?expired=1");

  return (
    <div>
      <h1 className="mb-1.5 text-center text-lg font-semibold tracking-tight">Set a new password</h1>
      <p className="text-muted-foreground mb-6 text-center text-sm">
        You&apos;re signed in via your reset link — choose a new password.
      </p>
      <ResetPasswordForm />
    </div>
  );
}
