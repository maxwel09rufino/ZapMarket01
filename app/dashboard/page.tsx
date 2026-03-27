import { DashboardShell } from "@/components/DashboardShell";
import { getDashboardOverview } from "@/lib/dashboard";
import { requireAuthenticatedUser } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireAuthenticatedUser("/dashboard");
  const initialOverview = await getDashboardOverview();

  return <DashboardShell initialOverview={initialOverview} />;
}
