import { requireOrg } from "@/lib/auth/session";
import { signOut } from "@/features/auth/actions";
import { Providers } from "@/components/providers";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { org, user } = await requireOrg();

  return (
    <Providers>
      <div className="flex min-h-full flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <span className="font-semibold">{org.name}</span>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <form action={signOut} className="flex items-center gap-3">
              <span className="text-muted-foreground text-sm">
                {user.email}
              </span>
              <button type="submit" className="text-sm underline">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="flex flex-1 flex-col p-6">{children}</main>
      </div>
    </Providers>
  );
}
