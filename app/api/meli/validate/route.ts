import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ensureActiveMeliCredentialAccessToken,
  ensureMeliSchema,
  MeliCredentialValidationError,
  resolveMeliUserId,
} from "@/lib/meli/store";
import { getProductFromLink, type MercadoLivreProduct } from "@/lib/products/mercadoLivreApi";

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

function resolveError(error: unknown) {
  if (error instanceof MeliCredentialValidationError) {
    return {
      status: 400,
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
    const configuredCredential = await ensureActiveMeliCredentialAccessToken(userId).catch(() => null);
    const result = await getProductFromLink(productLink, {
      accessToken: configuredCredential?.accessToken,
    });

    const responseTimeMs = Date.now() - startTime;
    let validationRecord: ValidationRecordInsert;

    if (isMercadoLivreApiError(result)) {
      validationRecord = {
        userId,
        credentialId: configuredCredential?.credential.id ?? null,
        productLink,
        productId: null,
        title: null,
        price: null,
        currency: null,
        imageUrl: null,
        sellerName: null,
        stock: null,
        isValid: false,
        errorMessage: result.message,
        validationStatus: "error",
        responseTimeMs,
      };
    } else {
      const productResult: MercadoLivreProduct = result;

      validationRecord = {
        userId,
        credentialId: configuredCredential?.credential.id ?? null,
        productLink,
        productId: productResult.id,
        title: productResult.title,
        price: productResult.price,
        currency: productResult.currency,
        imageUrl: productResult.image || productResult.thumbnail,
        sellerName: productResult.seller?.name || null,
        stock: productResult.stock,
        isValid: true,
        errorMessage: null,
        validationStatus: "success",
        responseTimeMs,
      };
    }

    const persistedValidation = await insertValidationRecord(validationRecord);
    const responseMessage = validationRecord.isValid
      ? "Produto validado com sucesso."
      : validationRecord.errorMessage || "Erro ao validar produto.";

    return NextResponse.json(
      {
        message: responseMessage,
        error: validationRecord.isValid ? null : responseMessage,
        validation: persistedValidation,
        product: isMercadoLivreApiError(result) ? null : result,
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
