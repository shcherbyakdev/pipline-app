import Link from "next/link";
import { redirect } from "next/navigation";
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
        <LoginForm next={nextPath} />
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
