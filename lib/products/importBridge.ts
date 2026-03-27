import { fetchMercadoLivreProductByConfiguredApi } from "@/lib/products/mercadoLivreConfigured";
import type { MercadoLivreFetchedProduct } from "@/lib/products/mercadoLivre";

export type ProductImportLookupMode = "meli-api";

export async function fetchMercadoLivreProductForImport(
  rawUrl: string,
  lookupMode: ProductImportLookupMode = "meli-api",
): Promise<MercadoLivreFetchedProduct> {
  void lookupMode;
  return fetchMercadoLivreProductByConfiguredApi(rawUrl);
}
