import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth-server";

export default async function ProdutosImportarPage() {
  await requireAuthenticatedUser("/produtos/importar");
  redirect("/produtos");
}
