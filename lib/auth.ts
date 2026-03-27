import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  type SessionTokenUser,
  verifySessionToken,
} from "@/lib/auth-token";

const DEFAULT_USER_PLAN = "Pro Plan";
const PASSWORD_MIN_LENGTH = 6;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: Date | string;
};

type LoginAttemptBucket = {
  firstFailureAt: number;
  failureCount: number;
  lockedUntil?: number;
};

const globalForAuth = globalThis as typeof globalThis & {
  ensureUsersSchemaPromise?: Promise<void> | null;
  authLoginAttempts?: Map<string, LoginAttemptBucket>;
};

const loginAttemptBuckets =
  globalForAuth.authLoginAttempts ?? (globalForAuth.authLoginAttempts = new Map());

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  plan: string;
  createdAt: string;
};

export type AuthSessionResponse = {
  authenticated: boolean;
  user?: AuthenticatedUser;
};

export class AuthValidationError extends Error {}
export class AuthConflictError extends Error {}
export class AuthAuthenticationError extends Error {}

export class AuthRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function createUserId() {
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }

  return `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeName(value: string | undefined | null) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeEmail(value: string | undefined | null) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeIdentifier(value: string | undefined | null) {
  return String(value ?? "").trim();
}

function sanitizePassword(value: string | undefined | null) {
  return String(value ?? "");
}

function toOptionalDateString(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toAuthenticatedUser(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    plan: DEFAULT_USER_PLAN,
    createdAt: toOptionalDateString(row.created_at),
  };
}

export function toSessionTokenUser(user: AuthenticatedUser): SessionTokenUser {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
  };
}

function validateUserName(name: string) {
  if (name.length < 3) {
    throw new AuthValidationError("Use pelo menos 3 caracteres no usuario.");
  }

  if (name.length > 80) {
    throw new AuthValidationError("Usuario muito longo.");
  }
}

function validateEmail(email: string) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new AuthValidationError("Informe um email valido.");
  }
}

function validatePassword(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AuthValidationError("A senha precisa ter pelo menos 6 caracteres.");
  }

  if (password.length > 200) {
    throw new AuthValidationError("Senha invalida.");
  }
}

async function ensureUsersSchema() {
  if (!globalForAuth.ensureUsersSchemaPromise) {
    globalForAuth.ensureUsersSchemaPromise = db
      .query(`
        CREATE TABLE IF NOT EXISTS users (
          id text PRIMARY KEY,
          name text NOT NULL,
          email text NOT NULL,
          password_hash text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT NOW()
        );

        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS name text;

        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS email text;

        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS password_hash text;

        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW();

        CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
          ON users (lower(email));

        CREATE UNIQUE INDEX IF NOT EXISTS users_name_unique_idx
          ON users (lower(name));
      `)
      .then(() => undefined)
      .catch((error) => {
        globalForAuth.ensureUsersSchemaPromise = null;
        throw error;
      });
  }

  await globalForAuth.ensureUsersSchemaPromise;
}

async function getUserById(userId: string) {
  await ensureUsersSchema();
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) {
    return null;
  }

  const result = await db.query<UserRow>(
    `
      SELECT
        id,
        name,
        email,
        password_hash,
        created_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [normalizedUserId],
  );

  return result.rows[0] ?? null;
}

async function getUserByEmail(email: string) {
  await ensureUsersSchema();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const result = await db.query<UserRow>(
    `
      SELECT
        id,
        name,
        email,
        password_hash,
        created_at
      FROM users
      WHERE lower(email) = lower($1)
      LIMIT 1
    `,
    [normalizedEmail],
  );

  return result.rows[0] ?? null;
}

async function getUserByName(name: string) {
  await ensureUsersSchema();
  const normalizedName = sanitizeName(name);
  if (!normalizedName) {
    return null;
  }

  const result = await db.query<UserRow>(
    `
      SELECT
        id,
        name,
        email,
        password_hash,
        created_at
      FROM users
      WHERE lower(name) = lower($1)
      LIMIT 1
    `,
    [normalizedName],
  );

  return result.rows[0] ?? null;
}

async function getUserByIdentifier(identifier: string) {
  await ensureUsersSchema();
  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (!normalizedIdentifier) {
    return null;
  }

  const result = await db.query<UserRow>(
    `
      SELECT
        id,
        name,
        email,
        password_hash,
        created_at
      FROM users
      WHERE lower(email) = lower($1)
         OR lower(name) = lower($1)
      LIMIT 1
    `,
    [normalizedIdentifier],
  );

  return result.rows[0] ?? null;
}

function resolveLoginAttemptKey(identifier: string, ipAddress: string) {
  return `${normalizeIdentifier(identifier).toLowerCase()}::${String(ipAddress ?? "").trim() || "unknown"}`;
}

function getRetryAfterSeconds(lockedUntil: number) {
  return Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
}

function assertLoginRateLimit(identifier: string, ipAddress: string) {
  const key = resolveLoginAttemptKey(identifier, ipAddress);
  const bucket = loginAttemptBuckets.get(key);
  if (!bucket) {
    return;
  }

  const now = Date.now();
  if (bucket.lockedUntil && bucket.lockedUntil > now) {
    throw new AuthRateLimitError(
      "Muitas tentativas de login. Aguarde alguns minutos e tente novamente.",
      getRetryAfterSeconds(bucket.lockedUntil),
    );
  }

  if (now - bucket.firstFailureAt > LOGIN_WINDOW_MS) {
    loginAttemptBuckets.delete(key);
  }
}

function recordFailedLogin(identifier: string, ipAddress: string) {
  const key = resolveLoginAttemptKey(identifier, ipAddress);
  const current = loginAttemptBuckets.get(key);
  const now = Date.now();

  if (!current || now - current.firstFailureAt > LOGIN_WINDOW_MS) {
    loginAttemptBuckets.set(key, {
      firstFailureAt: now,
      failureCount: 1,
    });
    return;
  }

  const nextFailureCount = current.failureCount + 1;
  loginAttemptBuckets.set(key, {
    firstFailureAt: current.firstFailureAt,
    failureCount: nextFailureCount,
    lockedUntil: nextFailureCount >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_LOCK_MS : current.lockedUntil,
  });
}

function clearFailedLogins(identifier: string, ipAddress: string) {
  loginAttemptBuckets.delete(resolveLoginAttemptKey(identifier, ipAddress));
}

export function resolveRequestIp(headers: Headers) {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [firstIp] = forwardedFor.split(",");
    const normalized = firstIp?.trim();
    if (normalized) {
      return normalized;
    }
  }

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

export async function createUserAccount(input: {
  name: string;
  email: string;
  password: string;
}) {
  const name = sanitizeName(input.name);
  const email = normalizeEmail(input.email);
  const password = sanitizePassword(input.password);

  validateUserName(name);
  validateEmail(email);
  validatePassword(password);

  await ensureUsersSchema();

  const [existingByEmail, existingByName] = await Promise.all([
    getUserByEmail(email),
    getUserByName(name),
  ]);

  if (existingByEmail) {
    throw new AuthConflictError("Ja existe uma conta cadastrada com esse email.");
  }

  if (existingByName) {
    throw new AuthConflictError("Ja existe uma conta cadastrada com esse usuario.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await db.query<UserRow>(
    `
      INSERT INTO users (
        id,
        name,
        email,
        password_hash
      )
      VALUES ($1, $2, $3, $4)
      RETURNING
        id,
        name,
        email,
        password_hash,
        created_at
    `,
    [createUserId(), name, email, passwordHash],
  );

  const createdUser = result.rows[0];
  if (!createdUser) {
    throw new AuthValidationError("Nao foi possivel criar a conta.");
  }

  return toAuthenticatedUser(createdUser);
}

export async function authenticateUser(input: {
  identifier: string;
  password: string;
  ipAddress: string;
}) {
  const identifier = normalizeIdentifier(input.identifier);
  const password = sanitizePassword(input.password);
  const ipAddress = String(input.ipAddress ?? "").trim() || "unknown";

  if (!identifier) {
    throw new AuthValidationError("Informe seu email ou usuario.");
  }

  validatePassword(password);
  assertLoginRateLimit(identifier, ipAddress);

  const user = await getUserByIdentifier(identifier);
  if (!user) {
    recordFailedLogin(identifier, ipAddress);
    throw new AuthAuthenticationError("Email/usuario ou senha invalidos.");
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    recordFailedLogin(identifier, ipAddress);
    throw new AuthAuthenticationError("Email/usuario ou senha invalidos.");
  }

  clearFailedLogins(identifier, ipAddress);
  return toAuthenticatedUser(user);
}

export async function findAuthenticatedUserByToken(token: string) {
  const session = await verifySessionToken(token);
  if (!session) {
    return null;
  }

  const user = await getUserById(session.userId);
  return user ? toAuthenticatedUser(user) : null;
}
