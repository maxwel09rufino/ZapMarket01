export type ProductMarketplace = "mercadolivre";

export type ProductMeliPublication = {
  itemId?: string;
  permalink?: string;
  status?: string;
  categoryId?: string;
  categoryName?: string;
  listingTypeId?: string;
  publishedAt?: Date;
  lastSyncAt?: Date;
  lastSyncError?: string;
};

export type Product = {
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
  marketplace: ProductMarketplace;
  seller?: string;
  meliPublication?: ProductMeliPublication;
  createdAt: Date;
};

export type ProductDTO = Omit<Product, "createdAt" | "meliPublication"> & {
  meliPublication?: Omit<ProductMeliPublication, "publishedAt" | "lastSyncAt"> & {
    publishedAt?: string;
    lastSyncAt?: string;
  };
  createdAt: string;
};

export function toProductDTO(product: Product): ProductDTO {
  return {
    ...product,
    meliPublication: product.meliPublication
      ? {
          ...product.meliPublication,
          publishedAt: product.meliPublication.publishedAt?.toISOString(),
          lastSyncAt: product.meliPublication.lastSyncAt?.toISOString(),
        }
      : undefined,
    createdAt: product.createdAt.toISOString(),
  };
}
