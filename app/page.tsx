import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getAuthenticatedUser();
  redirect(user ? "/dashboard" : "/login");
}
