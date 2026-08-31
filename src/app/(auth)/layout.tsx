import Link from "next/link";
import { BookloWordmark } from "@/features/marketing/components/booklo-mark";

/* Auth is the seam between the landing and the admin: the landing's ground,
   the wordmark up top, the form on a white panel with the layered shadow.
   Pages render only their content; this shell owns the composition. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-7 p-6">
      <Link
        href="/"
        className="text-foreground focus-visible:ring-ring focus-visible:ring-offset-background rounded-sm text-[23px] outline-none focus-visible:ring-2 focus-visible:ring-offset-4"
      >
        <BookloWordmark />
      </Link>
      <div className="bg-card w-full max-w-sm rounded-2xl border p-6 shadow-(--shadow-card) sm:p-7">
        {children}
      </div>
    </main>
  );
}
