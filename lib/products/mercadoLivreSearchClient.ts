export type MercadoLivreSearchSort = {
  id: string;
  name: string;
};

export type MercadoLivreSearchFilterValue = {
  id: string;
  name: string;
  results: number;
};

export type MercadoLivreSearchFilter = {
  id: string;
  name: string;
  values: MercadoLivreSearchFilterValue[];
};

export type MercadoLivreSearchItem = {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  currency: string;
  permalink: string;
  thumbnail?: string;
  image?: string;
  condition?: string;
  categoryId?: string;
  officialStoreId?: number | null;
  sellerId?: number | null;
  availableQuantity?: number;
};

export type MercadoLivreSearchQuery = {
  siteId?: string;
  query?: string;
  sellerId?: string;
  nickname?: string;
  categoryId?: string;
  officialStoreId?: string;
  condition?: string;
  sort?: string;
  limit?: number;
  offset?: number;
};

export type MercadoLivreSearchResponse = {
  siteId: string;
  query: string;
  sellerId?: string;
  nickname?: string;
  categoryId?: string;
  officialStoreId?: string;
  condition?: string;
  sort?: string;
  paging: {
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  };
  results: MercadoLivreSearchItem[];
  availableFilters: MercadoLivreSearchFilter[];
  availableSorts: MercadoLivreSearchSort[];
};
