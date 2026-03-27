import { NextRequest, NextResponse } from "next/server";
import {
  collectMercadoLivreSearchItems,
  collectMercadoLivreSearchItemsFromUrl,
  MercadoLivreSearchError,
  searchMercadoLivreItems,
} from "@/lib/products/mercadoLivreSearch";
import {
  discoverMercadoLivreListProductLinks,
  ProductListImportError,
} from "@/lib/products/mercadoLivreList";
import {
  buildMercadoLivreSearchApiQuery,
  parseMercadoLivreSearchUrl,
} from "@/lib/products/mercadoLivreSearchLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

function parseNumber(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBoolean(value: string | null | undefined) {
  const normalizedValue = String(value ?? "").trim().toLowerCase();
  return normalizedValue === "1" || normalizedValue === "true" || normalizedValue === "yes";
}

function mapCollectedProduct(item: {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  permalink: string;
  thumbnail?: string;
  image?: string;
  sellerId?: number | null;
  categoryId?: string;
  availableQuantity?: number;
}) {
  const image = item.image ?? item.thumbnail ?? null;

  return {
    id: item.id,
    title: item.title,
    titulo: item.title,
    price: item.price,
    preco: item.price,
    original_price: item.originalPrice ?? null,
    thumbnail: image,
    imagem: image,
    permalink: item.permalink,
    link: item.permalink,
    seller_id: item.sellerId ?? null,
    category_id: item.categoryId ?? null,
    available_quantity: item.availableQuantity ?? null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const sourceUrl = request.nextUrl.searchParams.get("url") ?? undefined;
    const collect = parseBoolean(request.nextUrl.searchParams.get("collect"));
    const parsedSearchUrl = sourceUrl ? parseMercadoLivreSearchUrl(sourceUrl) : null;

    if (collect) {
      const maxProducts =
        parseNumber(request.nextUrl.searchParams.get("maxProducts")) ??
        parseNumber(request.nextUrl.searchParams.get("limit")) ??
        200;
      let collected = null;

      if (parsedSearchUrl) {
        try {
          collected = await collectMercadoLivreSearchItemsFromUrl(sourceUrl as string, {
            maxProducts,
          });
        } catch (error) {
          if (!(error instanceof MercadoLivreSearchError)) {
            throw error;
          }

          const discovered = await discoverMercadoLivreListProductLinks(sourceUrl as string, {
            maxProducts,
          });

          return NextResponse.json(
            {
              sourceUrl: parsedSearchUrl.sourceUrl,
              normalizedUrl: discovered.normalizedUrl,
              siteId: parsedSearchUrl.siteId,
              searchTerm: parsedSearchUrl.searchTerm,
              query: parsedSearchUrl.searchTerm,
              apiQuery: parsedSearchUrl.apiQuery,
              strategy: "public-list-fallback",
              pagesScanned: discovered.pagesScanned,
              totalPages: discovered.totalPages,
              totalResults: discovered.totalResults,
              totalProducts: discovered.productLinks.length,
              total_produtos: discovered.productLinks.length,
              productLinks: discovered.productLinks,
              products: [],
              produtos: [],
            },
            {
              status: 200,
              headers: NO_STORE_HEADERS,
            },
          );
        }
      } else {
        collected = await collectMercadoLivreSearchItems({
          siteId: request.nextUrl.searchParams.get("siteId") ?? undefined,
          query: request.nextUrl.searchParams.get("q") ?? undefined,
          sellerId: request.nextUrl.searchParams.get("sellerId") ?? undefined,
          nickname: request.nextUrl.searchParams.get("nickname") ?? undefined,
          categoryId: request.nextUrl.searchParams.get("categoryId") ?? undefined,
          officialStoreId: request.nextUrl.searchParams.get("officialStoreId") ?? undefined,
          condition: request.nextUrl.searchParams.get("condition") ?? undefined,
          sort: request.nextUrl.searchParams.get("sort") ?? undefined,
          limit: parseNumber(request.nextUrl.searchParams.get("limit")) ?? 50,
          offset: parseNumber(request.nextUrl.searchParams.get("offset")),
          maxProducts,
        });
      }

      const products = collected.items.map(mapCollectedProduct);

      return NextResponse.json(
        {
          sourceUrl: parsedSearchUrl?.sourceUrl,
          normalizedUrl: parsedSearchUrl?.normalizedUrl,
          siteId: collected.siteId,
          searchTerm: parsedSearchUrl?.searchTerm ?? collected.query,
          query: collected.query,
          apiQuery: parsedSearchUrl?.apiQuery ?? buildMercadoLivreSearchApiQuery(collected.query),
          strategy: collected.strategy,
          pagesScanned: collected.pagesScanned,
          totalPages: collected.totalPages,
          totalResults: collected.totalResults ?? products.length,
          totalProducts: products.length,
          total_produtos: products.length,
          productLinks: collected.productLinks,
          products,
          produtos: products,
        },
        {
          status: 200,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    const response = await searchMercadoLivreItems({
      siteId: request.nextUrl.searchParams.get("siteId") ?? parsedSearchUrl?.siteId ?? undefined,
      query: request.nextUrl.searchParams.get("q") ?? parsedSearchUrl?.searchTerm ?? undefined,
      sellerId: request.nextUrl.searchParams.get("sellerId") ?? undefined,
      nickname: request.nextUrl.searchParams.get("nickname") ?? undefined,
      categoryId: request.nextUrl.searchParams.get("categoryId") ?? undefined,
      officialStoreId: request.nextUrl.searchParams.get("officialStoreId") ?? undefined,
      condition: request.nextUrl.searchParams.get("condition") ?? undefined,
      sort: request.nextUrl.searchParams.get("sort") ?? undefined,
      limit: parseNumber(request.nextUrl.searchParams.get("limit")),
      offset: parseNumber(request.nextUrl.searchParams.get("offset")),
    });

    return NextResponse.json(response, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    if (error instanceof ProductListImportError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: NO_STORE_HEADERS },
      );
    }

    if (error instanceof MercadoLivreSearchError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      { error: "Nao foi possivel consultar os produtos do Mercado Livre." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
