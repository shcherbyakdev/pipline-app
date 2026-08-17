import Link from "next/link";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Sign in to Booklo
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Use your email and password, or get a magic link.
        </p>
        {error === "auth" ? (
          <p className="text-destructive mb-4 text-sm">
            That link is invalid or has expired — request a new one.
          </p>
        ) : null}
        <LoginForm />
        <p className="text-muted-foreground mt-6 text-sm">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-foreground hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
