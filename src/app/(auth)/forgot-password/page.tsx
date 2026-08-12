import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Reset your password
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          We&apos;ll email you a link to set a new one.
        </p>
        <ForgotPasswordForm />
        <p className="text-muted-foreground mt-6 text-sm">
          <Link href="/login" className="text-foreground hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
