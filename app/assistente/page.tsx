import PlatformAssistantShell from "@/components/PlatformAssistantShell";
import { requireAuthenticatedUser } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function AssistentePage() {
  const user = await requireAuthenticatedUser("/assistente");

  return <PlatformAssistantShell userName={user.name} />;
}
