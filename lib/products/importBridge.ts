import { fetchMercadoLivreProductByConfiguredApi } from "@/lib/products/mercadoLivreConfigured";
import type { MercadoLivreFetchedProduct } from "@/lib/products/mercadoLivre";

export type ProductImportLookupMode = "html-root-app";

export async function fetchMercadoLivreProductForImport(
  rawUrl: string,
  lookupMode: ProductImportLookupMode = "html-root-app",
): Promise<MercadoLivreFetchedProduct> {
  void lookupMode;
  return fetchMercadoLivreProductByConfiguredApi(rawUrl);
}
