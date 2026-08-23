import Link from "next/link";
import { env } from "@/env";
import { HANDLE_RE, isReservedHandle } from "@/features/scheduling/handle";
import { hostLabel } from "@/lib/booking/url";
import { SignupForm } from "./signup-form";

// ?handle= comes from the landing claim bar. Anything malformed or reserved
// is dropped silently — the plain signup is the fallback, never an error.
export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { handle: raw } = await searchParams;
  const candidate = typeof raw === "string" ? raw : null;
  const handle = candidate && HANDLE_RE.test(candidate) && !isReservedHandle(candidate) ? candidate : null;
  const host = hostLabel(env.NEXT_PUBLIC_APP_URL);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Create your Booklo account
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          You&apos;ll confirm your email before signing in.
        </p>
        <SignupForm handle={handle} host={host} />
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
