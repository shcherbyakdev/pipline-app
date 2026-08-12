import Link from "next/link";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Create your RolloutOS account
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          You&apos;ll confirm your email before signing in.
        </p>
        <SignupForm />
        <p className="text-muted-foreground mt-6 text-sm">
          Already have an account?{" "}
          <Link href="/login" className="text-foreground hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
