import { randomBytes } from "crypto";
import axios, { AxiosError } from "axios";
import { db } from "@/lib/db";

const MELI_API_BASE = "https://api.mercadolibre.com";
const MELI_OAUTH_TIMEOUT_MS = 15000;
const MELI_OAUTH_SESSION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_LOCAL_USER_ID = "00000000-0000-0000-0000-000000000001";

type MeliCredentialRow = {
  id: string;
  user_id: string;
  credential_name: string | null;
  client_id: string | null;
  client_secret: string | null;
  refresh_token: string | null;
  access_token: string | null;
  token_type: string | null;
  expires_at: Date | string | null;
  meli_user_id: string | null;
  meli_nickname: string | null;
  site_id: string | null;
  affiliate_tracking_id: string | null;
  affiliate_slug: string | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  last_used_at: Date | string | null;
};

type MeliOAuthSessionRow = {
  id: string;
  user_id: string;
  state_token: string;
  credential_name: string | null;
  client_id: string | null;
  client_secret: string | null;
  affiliate_tracking_id: string | null;
  affiliate_slug: string | null;
  redirect_path: string | null;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type MeliOAuthResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  user_id?: number | string;
};

type MeliUserProfileResponse = {
  id?: number | string;
  nickname?: string;
  site_id?: string;
};

export type StoredMeliCredential = {
  id: string;
  userId: string;
  name?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  tokenType?: string;
  expiresAt?: string;
  meliUserId?: string;
  meliNickname?: string;
  siteId?: string;
  affiliateTrackingId?: string;
  affiliateSlug?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

export type PublicMeliCredential = Omit<
  StoredMeliCredential,
  "clientSecret" | "refreshToken" | "accessToken"
> & {
  clientIdPreview?: string;
  hasAccessToken: boolean;
};

export type CreateMeliCredentialInput = {
  userId?: string;
  name?: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  affiliateTrackingId?: string;
  affiliateSlug?: string;
};

export type CreateMeliOAuthSessionInput = {
  userId?: string;
  name?: string;
  clientId: string;
  clientSecret: string;
  affiliateTrackingId?: string;
  affiliateSlug?: string;
  redirectPath?: string;
  expiresInMs?: number;
};

type CreateMeliCredentialFromAuthorizationCodeInput = {
  stateToken: string;
  code: string;
  redirectUri: string;
};

export type MeliOAuthSession = {
  id: string;
  userId: string;
  stateToken: string;
  name?: string;
  clientId?: string;
  clientSecret?: string;
  affiliateTrackingId?: string;
  affiliateSlug?: string;
  redirectPath: string;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export class MeliCredentialValidationError extends Error {}
export class MeliCredentialNotFoundError extends Error {}

let ensureMeliSchemaPromise: Promise<void> | null = null;

function sanitizeText(value: string | undefined | null) {
  return String(value ?? "").trim();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function toIsoDate(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
}

function normalizeRedirectPath(value: string | undefined | null) {
  const normalized = sanitizeText(value);
  if (!normalized) {
    return "/configuracoes?tab=credentials";
  }

  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return "/configuracoes?tab=credentials";
  }

  return normalized;
}

function maskClientId(clientId: string | undefined) {
  const normalized = sanitizeText(clientId);
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= 8) {
    return normalized;
  }

  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function mapStoredCredential(row: MeliCredentialRow): StoredMeliCredential {
  return {
    id: row.id,
    userId: row.user_id,
    name: sanitizeText(row.credential_name) || undefined,
    clientId: sanitizeText(row.client_id) || undefined,
    clientSecret: sanitizeText(row.client_secret) || undefined,
    refreshToken: sanitizeText(row.refresh_token) || undefined,
    accessToken: sanitizeText(row.access_token) || undefined,
    tokenType: sanitizeText(row.token_type) || undefined,
    expiresAt: toIsoDate(row.expires_at),
    meliUserId: sanitizeText(row.meli_user_id) || undefined,
    meliNickname: sanitizeText(row.meli_nickname) || undefined,
    siteId: sanitizeText(row.site_id) || undefined,
    affiliateTrackingId: sanitizeText(row.affiliate_tracking_id) || undefined,
    affiliateSlug: sanitizeText(row.affiliate_slug) || undefined,
    isActive: Boolean(row.is_active),
    createdAt: toIsoDate(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoDate(row.updated_at) ?? new Date().toISOString(),
    lastUsedAt: toIsoDate(row.last_used_at),
  };
}

function toPublicCredential(credential: StoredMeliCredential): PublicMeliCredential {
  return {
    id: credential.id,
    userId: credential.userId,
    name: credential.name,
    clientId: credential.clientId,
    clientIdPreview: maskClientId(credential.clientId),
    tokenType: credential.tokenType,
    expiresAt: credential.expiresAt,
    meliUserId: credential.meliUserId,
    meliNickname: credential.meliNickname,
    siteId: credential.siteId,
    affiliateTrackingId: credential.affiliateTrackingId,
    affiliateSlug: credential.affiliateSlug,
    isActive: credential.isActive,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
    lastUsedAt: credential.lastUsedAt,
    hasAccessToken: Boolean(credential.accessToken),
  };
}

function mapStoredOAuthSession(row: MeliOAuthSessionRow): MeliOAuthSession {
  return {
    id: row.id,
    userId: row.user_id,
    stateToken: sanitizeText(row.state_token),
    name: sanitizeText(row.credential_name) || undefined,
    clientId: sanitizeText(row.client_id) || undefined,
    clientSecret: sanitizeText(row.client_secret) || undefined,
    affiliateTrackingId: sanitizeText(row.affiliate_tracking_id) || undefined,
    affiliateSlug: sanitizeText(row.affiliate_slug) || undefined,
    redirectPath: normalizeRedirectPath(row.redirect_path),
    expiresAt: toIsoDate(row.expires_at) ?? new Date().toISOString(),
    consumedAt: toIsoDate(row.consumed_at),
    createdAt: toIsoDate(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoDate(row.updated_at) ?? new Date().toISOString(),
  };
}

function resolveMeliApiErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof AxiosError) {
    const responseMessage =
      typeof error.response?.data === "object" &&
      error.response?.data &&
      "message" in error.response.data
        ? String(error.response.data.message)
        : typeof error.response?.data === "object" &&
            error.response?.data &&
            "error_description" in error.response.data
          ? String(error.response.data.error_description)
          : "";

    if (responseMessage) {
      return responseMessage;
    }

    if (error.code === "ECONNABORTED") {
      return "Tempo limite ao validar credenciais com o Mercado Livre.";
    }
  }

  return error instanceof Error && error.message ? error.message : fallbackMessage;
}

async function refreshAccessToken(payload: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}) {
  try {
    const response = await axios.post<MeliOAuthResponse>(
      `${MELI_API_BASE}/oauth/token`,
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: payload.clientId,
        client_secret: payload.clientSecret,
        refresh_token: payload.refreshToken,
      }).toString(),
      {
        timeout: MELI_OAUTH_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      },
    );

    return parseOAuthTokenResponse(response.data, payload.refreshToken);
  } catch (error) {
    const message = resolveMeliApiErrorMessage(
      error,
      "Nao foi possivel validar as credenciais do Mercado Livre.",
    );
    throw new MeliCredentialValidationError(message);
  }
}

function parseOAuthTokenResponse(data: MeliOAuthResponse, fallbackRefreshToken?: string) {
  const accessToken = sanitizeText(data.access_token);
  if (!accessToken) {
    throw new MeliCredentialValidationError(
      "O Mercado Livre nao retornou um access token valido.",
    );
  }

  const refreshToken = sanitizeText(data.refresh_token) || sanitizeText(fallbackRefreshToken);
  if (!refreshToken) {
    throw new MeliCredentialValidationError(
      "O Mercado Livre nao retornou um refresh token valido.",
    );
  }

  const tokenType = sanitizeText(data.token_type) || "Bearer";
  const expiresInSeconds =
    typeof data.expires_in === "number" && Number.isFinite(data.expires_in) ? data.expires_in : 21600;

  return {
    accessToken,
    refreshToken,
    tokenType,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  };
}

async function exchangeAuthorizationCode(payload: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}) {
  try {
    const response = await axios.post<MeliOAuthResponse>(
      `${MELI_API_BASE}/oauth/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: payload.clientId,
        client_secret: payload.clientSecret,
        code: payload.code,
        redirect_uri: payload.redirectUri,
      }).toString(),
      {
        timeout: MELI_OAUTH_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      },
    );

    return parseOAuthTokenResponse(response.data);
  } catch (error) {
    const message = resolveMeliApiErrorMessage(
      error,
      "Nao foi possivel concluir a autorizacao OAuth do Mercado Livre.",
    );
    throw new MeliCredentialValidationError(message);
  }
}

async function fetchMercadoLivreProfile(accessToken: string) {
  try {
    const response = await axios.get<MeliUserProfileResponse>(`${MELI_API_BASE}/users/me`, {
      timeout: MELI_OAUTH_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    return {
      meliUserId: sanitizeText(response.data.id ? String(response.data.id) : ""),
      meliNickname: sanitizeText(response.data.nickname),
      siteId: sanitizeText(response.data.site_id) || "MLB",
    };
  } catch (error) {
    const message = resolveMeliApiErrorMessage(
      error,
      "As credenciais foram aceitas, mas o perfil do Mercado Livre nao pode ser carregado.",
    );
    throw new MeliCredentialValidationError(message);
  }
}

async function getCredentialRowById(id: string) {
  await ensureMeliSchema();

  const result = await db.query<MeliCredentialRow>(
    `
      SELECT
        id,
        user_id,
        credential_name,
        client_id,
        client_secret,
        refresh_token,
        access_token,
        token_type,
        expires_at,
        meli_user_id,
        meli_nickname,
        site_id,
        affiliate_tracking_id,
        affiliate_slug,
        is_active,
        created_at,
        updated_at,
        last_used_at
      FROM meli_credentials
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );

  return result.rows[0] ?? null;
}

export function resolveMeliUserId(rawUserId: string | null | undefined) {
  const normalized = sanitizeText(rawUserId);
  return isUuid(normalized) ? normalized : DEFAULT_LOCAL_USER_ID;
}

export async function ensureMeliSchema() {
  if (!ensureMeliSchemaPromise) {
    ensureMeliSchemaPromise = (async () => {
      await db.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

      await db.query(`
        CREATE TABLE IF NOT EXISTS meli_credentials (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL DEFAULT '${DEFAULT_LOCAL_USER_ID}',
          credential_name text,
          client_id text,
          client_secret text,
          refresh_token text,
          access_token text,
          token_type text DEFAULT 'Bearer',
          expires_at timestamptz,
          meli_user_id text,
          meli_nickname text,
          site_id text DEFAULT 'MLB',
          affiliate_tracking_id text,
          affiliate_slug text,
          is_active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          last_used_at timestamptz
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS meli_product_validations (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL DEFAULT '${DEFAULT_LOCAL_USER_ID}',
          credential_id uuid REFERENCES meli_credentials(id) ON DELETE SET NULL,
          product_link text NOT NULL,
          product_id text,
          title text,
          price numeric(12, 2),
          currency text,
          image_url text,
          seller_name text,
          stock integer,
          is_valid boolean,
          error_message text,
          validation_status text CHECK (validation_status IN ('success', 'error', 'pending')),
          user_agent text,
          response_time_ms integer,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS meli_credential_logs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          credential_id uuid NOT NULL REFERENCES meli_credentials(id) ON DELETE CASCADE,
          action text NOT NULL CHECK (action IN ('created', 'updated', 'refreshed', 'revoked', 'error')),
          details jsonb,
          error_message text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS meli_oauth_sessions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL DEFAULT '${DEFAULT_LOCAL_USER_ID}',
          state_token text NOT NULL UNIQUE,
          credential_name text,
          client_id text,
          client_secret text,
          affiliate_tracking_id text,
          affiliate_slug text,
          redirect_path text,
          expires_at timestamptz NOT NULL,
          consumed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      await db.query(`ALTER TABLE meli_credentials ADD COLUMN IF NOT EXISTS credential_name text`);
      await db.query(`ALTER TABLE meli_credentials ADD COLUMN IF NOT EXISTS client_id text`);
      await db.query(`ALTER TABLE meli_credentials ADD COLUMN IF NOT EXISTS client_secret text`);
      await db.query(`ALTER TABLE meli_credentials ADD COLUMN IF NOT EXISTS refresh_token text`);
      await db.query(`ALTER TABLE meli_credentials ADD COLUMN IF NOT EXISTS access_token text`);
      await db.query(`ALTER TABLE meli_credentials ADD COLUMN IF NOT EXISTS token_type text DEFAULT 'Bearer'`);
      await db.query(`ALTER TABLE meli_credentials ADD COLUMN IF NOT EXISTS expires_at timestamptz`);
      await db.query(`ALTER TABLE meli_credentials ADD COLUMN IF NOT EXISTS meli_user_id text`);
      await db.query(`ALTER TABLE meli_credentials ADD COLUMN IF NOT EXISTS meli_nickname text`);
      await db.query(`ALTER TABLE meli_credentials ADD COLUMN IF NOT EXISTS site_id text DEFAULT 'MLB'`);
      await db.query(`ALTER TABLE meli_credentials ADD COLUMN IF NOT EXISTS affiliate_tracking_id text`);
      await db.query(`ALTER TABLE meli_credentials ADD COLUMN IF NOT EXISTS affiliate_slug text`);
      await db.query(`ALTER TABLE meli_credentials ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true`);
      await db.query(`ALTER TABLE meli_credentials ADD COLUMN IF NOT EXISTS last_used_at timestamptz`);
      await db.query(`ALTER TABLE meli_credentials ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`);
      await db.query(`ALTER TABLE meli_oauth_sessions ADD COLUMN IF NOT EXISTS credential_name text`);
      await db.query(`ALTER TABLE meli_oauth_sessions ADD COLUMN IF NOT EXISTS client_id text`);
      await db.query(`ALTER TABLE meli_oauth_sessions ADD COLUMN IF NOT EXISTS client_secret text`);
      await db.query(`ALTER TABLE meli_oauth_sessions ADD COLUMN IF NOT EXISTS affiliate_tracking_id text`);
      await db.query(`ALTER TABLE meli_oauth_sessions ADD COLUMN IF NOT EXISTS affiliate_slug text`);
      await db.query(`ALTER TABLE meli_oauth_sessions ADD COLUMN IF NOT EXISTS redirect_path text`);
      await db.query(`ALTER TABLE meli_oauth_sessions ADD COLUMN IF NOT EXISTS expires_at timestamptz`);
      await db.query(`ALTER TABLE meli_oauth_sessions ADD COLUMN IF NOT EXISTS consumed_at timestamptz`);
      await db.query(`ALTER TABLE meli_oauth_sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`);

      await db.query(`CREATE INDEX IF NOT EXISTS meli_credentials_user_id_idx ON meli_credentials(user_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS meli_credentials_active_idx ON meli_credentials(user_id, is_active, created_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS meli_product_validations_user_id_idx ON meli_product_validations(user_id, created_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS meli_credential_logs_credential_id_idx ON meli_credential_logs(credential_id, created_at DESC)`);
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS meli_oauth_sessions_state_token_idx ON meli_oauth_sessions(state_token)`);
      await db.query(`CREATE INDEX IF NOT EXISTS meli_oauth_sessions_user_id_idx ON meli_oauth_sessions(user_id, created_at DESC)`);
    })().catch((error) => {
      ensureMeliSchemaPromise = null;
      throw error;
    });
  }

  await ensureMeliSchemaPromise;
}

export async function listMeliCredentials(userId = DEFAULT_LOCAL_USER_ID) {
  await ensureMeliSchema();

  const result = await db.query<MeliCredentialRow>(
    `
      SELECT
        id,
        user_id,
        credential_name,
        client_id,
        client_secret,
        refresh_token,
        access_token,
        token_type,
        expires_at,
        meli_user_id,
        meli_nickname,
        site_id,
        affiliate_tracking_id,
        affiliate_slug,
        is_active,
        created_at,
        updated_at,
        last_used_at
      FROM meli_credentials
      WHERE user_id = $1
      ORDER BY is_active DESC, created_at DESC
    `,
    [userId],
  );

  return result.rows.map(mapStoredCredential).map(toPublicCredential);
}

export async function getActiveMeliCredential(userId = DEFAULT_LOCAL_USER_ID) {
  await ensureMeliSchema();

  const result = await db.query<MeliCredentialRow>(
    `
      SELECT
        id,
        user_id,
        credential_name,
        client_id,
        client_secret,
        refresh_token,
        access_token,
        token_type,
        expires_at,
        meli_user_id,
        meli_nickname,
        site_id,
        affiliate_tracking_id,
        affiliate_slug,
        is_active,
        created_at,
        updated_at,
        last_used_at
      FROM meli_credentials
      WHERE user_id = $1
        AND is_active = true
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0] ? mapStoredCredential(result.rows[0]) : null;
}

async function saveValidatedCredential(input: {
  userId: string;
  name?: string;
  clientId: string;
  clientSecret: string;
  affiliateTrackingId?: string;
  affiliateSlug?: string;
  tokenData: {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresAt: Date;
  };
  profile: {
    meliUserId: string;
    meliNickname: string;
    siteId: string;
  };
  authFlow: "refresh_token" | "authorization_code";
}) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query(`UPDATE meli_credentials SET is_active = false, updated_at = now() WHERE user_id = $1`, [
      input.userId,
    ]);

    const insertResult = await client.query<MeliCredentialRow>(
      `
        INSERT INTO meli_credentials (
          user_id,
          credential_name,
          client_id,
          client_secret,
          refresh_token,
          access_token,
          token_type,
          expires_at,
          meli_user_id,
          meli_nickname,
          site_id,
          affiliate_tracking_id,
          affiliate_slug,
          is_active,
          last_used_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, now(), now())
        RETURNING
          id,
          user_id,
          credential_name,
          client_id,
          client_secret,
          refresh_token,
          access_token,
          token_type,
          expires_at,
          meli_user_id,
          meli_nickname,
          site_id,
          affiliate_tracking_id,
          affiliate_slug,
          is_active,
          created_at,
          updated_at,
          last_used_at
      `,
      [
        input.userId,
        sanitizeText(input.name) || input.profile.meliNickname || input.profile.meliUserId || "Mercado Livre",
        input.clientId,
        input.clientSecret,
        input.tokenData.refreshToken,
        input.tokenData.accessToken,
        input.tokenData.tokenType,
        input.tokenData.expiresAt,
        input.profile.meliUserId || null,
        input.profile.meliNickname || null,
        input.profile.siteId || "MLB",
        sanitizeText(input.affiliateTrackingId) || null,
        sanitizeText(input.affiliateSlug) || null,
      ],
    );

    const credential = insertResult.rows[0];

    await client.query(
      `
        INSERT INTO meli_credential_logs (credential_id, action, details)
        VALUES ($1, 'created', $2::jsonb)
      `,
      [
        credential.id,
        JSON.stringify({
          clientId: input.clientId,
          meliUserId: input.profile.meliUserId,
          meliNickname: input.profile.meliNickname,
          affiliateTrackingId: sanitizeText(input.affiliateTrackingId) || null,
          affiliateSlug: sanitizeText(input.affiliateSlug) || null,
          authFlow: input.authFlow,
        }),
      ],
    );

    await client.query("COMMIT");
    return toPublicCredential(mapStoredCredential(credential));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createMeliCredential(input: CreateMeliCredentialInput) {
  const userId = resolveMeliUserId(input.userId);
  const name = sanitizeText(input.name);
  const clientId = sanitizeText(input.clientId);
  const clientSecret = sanitizeText(input.clientSecret);
  const refreshToken = sanitizeText(input.refreshToken);
  const affiliateTrackingId = sanitizeText(input.affiliateTrackingId);
  const affiliateSlug = sanitizeText(input.affiliateSlug);

  if (!clientId || !clientSecret || !refreshToken) {
    throw new MeliCredentialValidationError(
      "Preencha client_id, client_secret e refresh_token.",
    );
  }

  await ensureMeliSchema();

  const tokenData = await refreshAccessToken({
    clientId,
    clientSecret,
    refreshToken,
  });
  const profile = await fetchMercadoLivreProfile(tokenData.accessToken);
  return saveValidatedCredential({
    userId,
    name,
    clientId,
    clientSecret,
    affiliateTrackingId,
    affiliateSlug,
    tokenData,
    profile,
    authFlow: "refresh_token",
  });
}

export async function createMeliOAuthSession(input: CreateMeliOAuthSessionInput) {
  const userId = resolveMeliUserId(input.userId);
  const name = sanitizeText(input.name);
  const clientId = sanitizeText(input.clientId);
  const clientSecret = sanitizeText(input.clientSecret);
  const affiliateTrackingId = sanitizeText(input.affiliateTrackingId);
  const affiliateSlug = sanitizeText(input.affiliateSlug);
  const redirectPath = normalizeRedirectPath(input.redirectPath);
  const expiresInMs =
    typeof input.expiresInMs === "number" && Number.isFinite(input.expiresInMs) && input.expiresInMs > 0
      ? input.expiresInMs
      : MELI_OAUTH_SESSION_TTL_MS;

  if (!clientId || !clientSecret) {
    throw new MeliCredentialValidationError(
      "Preencha client_id e client_secret para iniciar a conexao OAuth.",
    );
  }

  await ensureMeliSchema();

  await db.query(
    `
      DELETE FROM meli_oauth_sessions
      WHERE user_id = $1
        AND (consumed_at IS NOT NULL OR expires_at <= now())
    `,
    [userId],
  );

  const stateToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + expiresInMs);

  const result = await db.query<MeliOAuthSessionRow>(
    `
      INSERT INTO meli_oauth_sessions (
        user_id,
        state_token,
        credential_name,
        client_id,
        client_secret,
        affiliate_tracking_id,
        affiliate_slug,
        redirect_path,
        expires_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
      RETURNING
        id,
        user_id,
        state_token,
        credential_name,
        client_id,
        client_secret,
        affiliate_tracking_id,
        affiliate_slug,
        redirect_path,
        expires_at,
        consumed_at,
        created_at,
        updated_at
    `,
    [
      userId,
      stateToken,
      name || null,
      clientId,
      clientSecret,
      affiliateTrackingId || null,
      affiliateSlug || null,
      redirectPath,
      expiresAt,
    ],
  );

  return mapStoredOAuthSession(result.rows[0]);
}

async function consumeMeliOAuthSession(stateToken: string) {
  await ensureMeliSchema();

  const normalizedStateToken = sanitizeText(stateToken);
  if (!normalizedStateToken) {
    throw new MeliCredentialValidationError("Sessao OAuth invalida ou ausente.");
  }

  const result = await db.query<MeliOAuthSessionRow>(
    `
      UPDATE meli_oauth_sessions
      SET
        consumed_at = now(),
        updated_at = now()
      WHERE state_token = $1
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING
        id,
        user_id,
        state_token,
        credential_name,
        client_id,
        client_secret,
        affiliate_tracking_id,
        affiliate_slug,
        redirect_path,
        expires_at,
        consumed_at,
        created_at,
        updated_at
    `,
    [normalizedStateToken],
  );

  const session = result.rows[0];
  if (!session) {
    throw new MeliCredentialValidationError(
      "A sessao OAuth do Mercado Livre expirou ou ja foi utilizada. Inicie a conexao novamente.",
    );
  }

  return mapStoredOAuthSession(session);
}

export async function createMeliCredentialFromAuthorizationCode(
  input: CreateMeliCredentialFromAuthorizationCodeInput,
) {
  const stateToken = sanitizeText(input.stateToken);
  const code = sanitizeText(input.code);
  const redirectUri = sanitizeText(input.redirectUri);

  if (!stateToken || !code || !redirectUri) {
    throw new MeliCredentialValidationError(
      "Callback OAuth invalido. Verifique o codigo de autorizacao e tente novamente.",
    );
  }

  const session = await consumeMeliOAuthSession(stateToken);
  const clientId = sanitizeText(session.clientId);
  const clientSecret = sanitizeText(session.clientSecret);

  if (!clientId || !clientSecret) {
    throw new MeliCredentialValidationError(
      "A sessao OAuth nao possui client_id ou client_secret validos.",
    );
  }

  const tokenData = await exchangeAuthorizationCode({
    clientId,
    clientSecret,
    code,
    redirectUri,
  });
  const profile = await fetchMercadoLivreProfile(tokenData.accessToken);
  const credential = await saveValidatedCredential({
    userId: session.userId,
    name: session.name,
    clientId,
    clientSecret,
    affiliateTrackingId: session.affiliateTrackingId,
    affiliateSlug: session.affiliateSlug,
    tokenData,
    profile,
    authFlow: "authorization_code",
  });

  return {
    credential,
    redirectPath: session.redirectPath,
  };
}

export async function deleteMeliCredential(credentialId: string, userId = DEFAULT_LOCAL_USER_ID) {
  await ensureMeliSchema();

  const normalizedId = sanitizeText(credentialId);
  if (!normalizedId) {
    throw new MeliCredentialNotFoundError("Credencial nao encontrada.");
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const currentResult = await client.query<MeliCredentialRow>(
      `
        SELECT
          id,
          user_id,
          credential_name,
          client_id,
          client_secret,
          refresh_token,
          access_token,
          token_type,
          expires_at,
          meli_user_id,
          meli_nickname,
          site_id,
          affiliate_tracking_id,
          affiliate_slug,
          is_active,
          created_at,
          updated_at,
          last_used_at
        FROM meli_credentials
        WHERE id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [normalizedId, userId],
    );

    const deleted = currentResult.rows[0];
    if (!deleted) {
      throw new MeliCredentialNotFoundError("Credencial nao encontrada.");
    }

    await client.query(
      `
        INSERT INTO meli_credential_logs (credential_id, action, details)
        VALUES ($1, 'revoked', $2::jsonb)
      `,
      [
        deleted.id,
        JSON.stringify({
          revokedAt: new Date().toISOString(),
        }),
      ],
    );

    await client.query(
      `
        DELETE FROM meli_credentials
        WHERE id = $1
          AND user_id = $2
      `,
      [normalizedId, userId],
    );

    if (deleted.is_active) {
      await client.query(
        `
          WITH next_active AS (
            SELECT id
            FROM meli_credentials
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 1
          )
          UPDATE meli_credentials
          SET
            is_active = true,
            updated_at = now()
          FROM next_active
          WHERE meli_credentials.id = next_active.id
        `,
        [userId],
      );
    }

    await client.query("COMMIT");
    return toPublicCredential(mapStoredCredential(deleted));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function touchMeliCredentialUsage(credentialId: string) {
  await ensureMeliSchema();

  await db.query(
    `
      UPDATE meli_credentials
      SET
        last_used_at = now(),
        updated_at = now()
      WHERE id = $1
    `,
    [credentialId],
  );
}

export async function ensureActiveMeliCredentialAccessToken(userId = DEFAULT_LOCAL_USER_ID) {
  const activeCredential = await getActiveMeliCredential(userId);
  if (!activeCredential) {
    return null;
  }

  const storedCredentialRow = await getCredentialRowById(activeCredential.id);
  if (!storedCredentialRow) {
    return null;
  }

  const clientId = sanitizeText(storedCredentialRow.client_id);
  const clientSecret = sanitizeText(storedCredentialRow.client_secret);
  const refreshToken = sanitizeText(storedCredentialRow.refresh_token);

  if (!clientId || !clientSecret || !refreshToken) {
    throw new MeliCredentialValidationError(
      "A credencial ativa do Mercado Livre esta incompleta. Atualize client_id, client_secret e refresh_token.",
    );
  }

  const currentAccessToken = sanitizeText(storedCredentialRow.access_token);
  const currentExpiresAt = storedCredentialRow.expires_at
    ? new Date(storedCredentialRow.expires_at)
    : null;
  const tokenStillValid =
    currentAccessToken &&
    currentExpiresAt &&
    !Number.isNaN(currentExpiresAt.getTime()) &&
    currentExpiresAt.getTime() - Date.now() > 60_000;

  if (tokenStillValid) {
    await touchMeliCredentialUsage(storedCredentialRow.id);
    return {
      credential: mapStoredCredential(storedCredentialRow),
      accessToken: currentAccessToken,
    };
  }

  const tokenData = await refreshAccessToken({
    clientId,
    clientSecret,
    refreshToken,
  });

  const profile = await fetchMercadoLivreProfile(tokenData.accessToken);

  const updateResult = await db.query<MeliCredentialRow>(
    `
      UPDATE meli_credentials
      SET
        refresh_token = $2,
        access_token = $3,
        token_type = $4,
        expires_at = $5,
        meli_user_id = $6,
        meli_nickname = $7,
        site_id = $8,
        last_used_at = now(),
        updated_at = now()
      WHERE id = $1
      RETURNING
        id,
        user_id,
        credential_name,
        client_id,
        client_secret,
        refresh_token,
        access_token,
        token_type,
        expires_at,
        meli_user_id,
        meli_nickname,
        site_id,
        affiliate_tracking_id,
        affiliate_slug,
        is_active,
        created_at,
        updated_at,
        last_used_at
    `,
    [
      storedCredentialRow.id,
      tokenData.refreshToken,
      tokenData.accessToken,
      tokenData.tokenType,
      tokenData.expiresAt,
      profile.meliUserId || storedCredentialRow.meli_user_id,
      profile.meliNickname || storedCredentialRow.meli_nickname,
      profile.siteId || storedCredentialRow.site_id || "MLB",
    ],
  );

  const updatedCredential = updateResult.rows[0];
  if (!updatedCredential) {
    throw new MeliCredentialNotFoundError("Credencial ativa nao encontrada.");
  }

  await db.query(
    `
      INSERT INTO meli_credential_logs (credential_id, action, details)
      VALUES ($1, 'refreshed', $2::jsonb)
    `,
    [
      updatedCredential.id,
      JSON.stringify({
        refreshedAt: new Date().toISOString(),
        expiresAt: tokenData.expiresAt.toISOString(),
      }),
    ],
  );

  return {
    credential: mapStoredCredential(updatedCredential),
    accessToken: tokenData.accessToken,
  };
}
