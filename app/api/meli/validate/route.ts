import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ensureMeliSchema,
  resolveMeliUserId,
} from "@/lib/meli/store";
import { fetchMercadoLivreProductByConfiguredApi } from "@/lib/products/mercadoLivreConfigured";
import type { MercadoLivreFetchedProduct } from "@/lib/products/mercadoLivre";
import { ProductLookupError } from "@/lib/products/mercadoLivre";
import { extractMercadoLivreItemIdFromUrl } from "@/lib/products/mercadoLivreLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

type ValidateBody = {
  product_link?: string;
};

type ValidationRecordInsert = {
  userId: string;
  credentialId: string | null;
  productLink: string;
  productId: string | null;
  title: string | null;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  sellerName: string | null;
  stock: number | null;
  isValid: boolean;
  errorMessage: string | null;
  validationStatus: "success" | "error";
  responseTimeMs: number;
};

function resolveError(error: unknown) {
  if (error instanceof ProductLookupError) {
    return {
      status: error.status,
      message: error.message,
    };
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);

    if (code === "28P01") {
      return {
        status: 500,
        message: "Falha ao autenticar no PostgreSQL. Verifique o DATABASE_URL.",
      };
    }

    if (code === "3D000") {
      return {
        status: 500,
        message: "Banco de dados nao encontrado. Verifique se o banco 'zapmarket' existe.",
      };
    }
  }

  return {
    status: 500,
    message: "Erro ao validar produto do Mercado Livre.",
  };
}

async function insertValidationRecord(record: ValidationRecordInsert) {
  const result = await db.query(
    `
      INSERT INTO meli_product_validations (
        user_id,
        credential_id,
        product_link,
        product_id,
        title,
        price,
        currency,
        image_url,
        seller_name,
        stock,
        is_valid,
        error_message,
        validation_status,
        response_time_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `,
    [
      record.userId,
      record.credentialId,
      record.productLink,
      record.productId,
      record.title,
      record.price,
      record.currency,
      record.imageUrl,
      record.sellerName,
      record.stock,
      record.isValid,
      record.errorMessage,
      record.validationStatus,
      record.responseTimeMs,
    ],
  );

  return result.rows[0];
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ValidateBody | null;
  const productLink = (body?.product_link ?? "").trim();

  if (!productLink) {
    return NextResponse.json(
      { error: "product_link e obrigatorio" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    await ensureMeliSchema();

    const userId = resolveMeliUserId(request.headers.get("x-user-id"));
    const startTime = Date.now();
    const result = await fetchMercadoLivreProductByConfiguredApi(productLink);

    const responseTimeMs = Date.now() - startTime;
    const productResult: MercadoLivreFetchedProduct = result;
    const validationRecord: ValidationRecordInsert = {
      userId,
      credentialId: null,
      productLink,
      productId:
        extractMercadoLivreItemIdFromUrl(productResult.canonicalLink ?? productResult.link) ?? null,
      title: productResult.title,
      price: productResult.price,
      currency: "BRL",
      imageUrl: productResult.image || productResult.images[0] || null,
      sellerName: productResult.seller || null,
      stock: productResult.stock ?? null,
      isValid: true,
      errorMessage: null,
      validationStatus: "success",
      responseTimeMs,
    };

    const persistedValidation = await insertValidationRecord(validationRecord);
    const responseMessage = validationRecord.isValid
      ? "Produto validado com sucesso."
      : validationRecord.errorMessage || "Erro ao validar produto.";

    return NextResponse.json(
      {
        message: responseMessage,
        error: validationRecord.isValid ? null : responseMessage,
        validation: persistedValidation,
        product: result,
      },
      {
        status: validationRecord.isValid ? 200 : 400,
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    const resolved = resolveError(error);
    return NextResponse.json(
      { error: resolved.message },
      { status: resolved.status, headers: NO_STORE_HEADERS },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    await ensureMeliSchema();

    const userId = resolveMeliUserId(request.headers.get("x-user-id"));
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "10");
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");

    const result = await db.query(
      `
        SELECT
          id,
          credential_id,
          product_link,
          product_id,
          title,
          price,
          currency,
          image_url,
          seller_name,
          stock,
          is_valid,
          error_message,
          validation_status,
          response_time_ms,
          created_at
        FROM meli_product_validations
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset],
    );

    const countResult = await db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM meli_product_validations WHERE user_id = $1`,
      [userId],
    );

    return NextResponse.json(
      {
        validations: result.rows,
        total: Number(countResult.rows[0]?.total ?? 0),
        limit,
        offset,
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    const resolved = resolveError(error);
    return NextResponse.json(
      { error: resolved.message },
      { status: resolved.status, headers: NO_STORE_HEADERS },
    );
  }
}
