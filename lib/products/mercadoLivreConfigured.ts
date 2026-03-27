import {
  ensureActiveMeliCredentialAccessToken,
  MeliCredentialValidationError,
} from "@/lib/meli/store";
import {
  getProductFromLink,
  type MercadoLivreProduct,
} from "@/lib/products/mercadoLivreApi";
import {
  fetchMercadoLivreProductByUrl,
  PRODUCT_LOOKUP_ERROR_MESSAGE,
  ProductLookupError,
  type MercadoLivreFetchedProduct,
} from "@/lib/products/mercadoLivre";

function mapMercadoLivreApiProduct(product: MercadoLivreProduct): MercadoLivreFetchedProduct {
  const images = product.images.filter((entry) => entry.trim().length > 0);
  const image = product.image || product.thumbnail || images[0] || "";
  const discount = product.discount ?? calculateDiscount(product.price, product.originalPrice);
  const hasCouponOrDiscount =
    Boolean(product.hasCouponOrDiscount) || Boolean(discount && discount > 0);

  return {
    title: product.title,
    price: product.price,
    originalPrice: product.originalPrice,
    discount,
    hasCouponOrDiscount,
    couponLabel: product.couponLabel,
    image,
    images: image && !images.includes(image) ? [image, ...images] : images,
    description: product.description || "",
    link: product.permalink,
    canonicalLink: product.permalink,
    marketplace: "mercadolivre",
    seller: product.seller?.name,
    stock: product.stock,
    stockIsReferential: product.stockIsReferential,
    variations: product.variations,
  };
}

function calculateDiscount(price: number, originalPrice?: number) {
  if (originalPrice === undefined || originalPrice <= price || originalPrice <= 0) {
    return undefined;
  }

  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

function isMercadoLivreApiError(
  result: Awaited<ReturnType<typeof getProductFromLink>>,
): result is {
  error: true;
  code: string;
  message: string;
  status?: number;
} {
  return "error" in result && result.error === true;
}

export async function fetchMercadoLivreProductByConfiguredApi(
  rawUrl: string,
): Promise<MercadoLivreFetchedProduct> {
  const configuredCredential = await ensureActiveMeliCredentialAccessToken().catch((error) => {
    if (error instanceof MeliCredentialValidationError) {
      return null;
    }

    throw error;
  });

  try {
    if (configuredCredential?.accessToken) {
      const result = await getProductFromLink(rawUrl, {
        accessToken: configuredCredential.accessToken,
        sellerUserId: configuredCredential.credential.meliUserId,
      });

      if (isMercadoLivreApiError(result)) {
        throw new ProductLookupError(
          result.message || PRODUCT_LOOKUP_ERROR_MESSAGE,
          result.status ?? 500,
        );
      }

      return mapMercadoLivreApiProduct(result);
    }

    return await fetchMercadoLivreProductByUrl(rawUrl);
  } catch (error) {
    if (error instanceof MeliCredentialValidationError || error instanceof ProductLookupError) {
      try {
        return await fetchMercadoLivreProductByUrl(rawUrl);
      } catch (fallbackError) {
        if (fallbackError instanceof ProductLookupError) {
          throw fallbackError;
        }

        if (error instanceof ProductLookupError) {
          throw error;
        }

        throw new ProductLookupError(
          fallbackError instanceof Error && fallbackError.message
            ? fallbackError.message
            : PRODUCT_LOOKUP_ERROR_MESSAGE,
          500,
        );
      }
    }

    throw new ProductLookupError(
      error instanceof Error && error.message ? error.message : PRODUCT_LOOKUP_ERROR_MESSAGE,
      500,
    );
  }
}
