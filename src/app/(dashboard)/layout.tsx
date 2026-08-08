import { requireOrg } from "@/lib/auth/session";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { org, user } = await requireOrg();

  return (
    <Providers>
      <AppShell org={org.name} userEmail={user.email ?? ""}>
        {children}
      </AppShell>
    </Providers>
  );
}
