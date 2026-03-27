import {
  fetchMercadoLivreProductByHtml,
  ProductLookupError,
  type MercadoLivreFetchedProduct,
} from "@/lib/products/mercadoLivre";

export async function fetchMercadoLivreProductByConfiguredApi(
  rawUrl: string,
): Promise<MercadoLivreFetchedProduct> {
  try {
    return await fetchMercadoLivreProductByHtml(rawUrl);
  } catch (error) {
    if (error instanceof ProductLookupError) {
      throw error;
    }

    throw new ProductLookupError(
      error instanceof Error && error.message ? error.message : "Produto nao encontrado ou link invalido.",
      500,
    );
  }
}
