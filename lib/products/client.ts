export type ProductMeliPublicationRecord = {
  itemId?: string;
  permalink?: string;
  status?: string;
  categoryId?: string;
  categoryName?: string;
  listingTypeId?: string;
  publishedAt?: string;
  lastSyncAt?: string;
  lastSyncError?: string;
};

export type ProductRecord = {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  discount?: number;
  hasCouponOrDiscount: boolean;
  couponLabel?: string;
  image: string;
  images: string[];
  description: string;
  itemId?: string;
  link: string;
  linkOriginal: string;
  linkAffiliate?: string;
  linkShort?: string;
  position?: number;
  marketingMessage: string;
  marketplace: "mercadolivre";
  seller?: string;
  meliPublication?: ProductMeliPublicationRecord;
  createdAt: string;
};

export type ProductUpsertPayload = Omit<ProductRecord, "id" | "createdAt" | "marketingMessage"> & {
  marketingMessage?: string;
};

export function formatCurrencyBRL(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  });
}

export function calculateDiscount(price: number, originalPrice?: number) {
  if (originalPrice === undefined || originalPrice <= price || originalPrice <= 0) {
    return undefined;
  }

  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

export function getProductOfferLabel(product: {
  couponLabel?: string;
  discount?: number | null;
  hasCouponOrDiscount?: boolean;
}) {
  const couponLabel = (product.couponLabel ?? "").trim();
  if (couponLabel.length > 0) {
    return couponLabel;
  }

  if (product.discount !== undefined && product.discount !== null && product.discount > 0) {
    return `-${product.discount}%`;
  }

  return product.hasCouponOrDiscount ? "Cupom ativo" : undefined;
}
