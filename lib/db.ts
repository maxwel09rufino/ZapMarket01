import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  pgPool?: Pool;
};

const ENABLE_SSL_VALUES = new Set(["1", "true", "yes", "on", "require", "prefer"]);
const DISABLE_SSL_VALUES = new Set(["0", "false", "no", "off", "disable"]);

function resolveDatabaseSsl(connectionString: string | undefined) {
  const configuredValue = String(process.env.DATABASE_SSL ?? process.env.PGSSLMODE ?? "")
    .trim()
    .toLowerCase();

  if (ENABLE_SSL_VALUES.has(configuredValue)) {
    return { rejectUnauthorized: false };
  }

  if (DISABLE_SSL_VALUES.has(configuredValue)) {
    return undefined;
  }

  const normalizedConnectionString = String(connectionString ?? "").trim();
  if (!normalizedConnectionString) {
    return undefined;
  }

  try {
    const parsed = new URL(normalizedConnectionString);
    const host = parsed.hostname.trim().toLowerCase();
    if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return undefined;
    }

    return { rejectUnauthorized: false };
  } catch {
    return undefined;
  }
}

const databaseUrl = process.env.DATABASE_URL;
const databaseSsl = resolveDatabaseSsl(databaseUrl);

export const db =
  globalForDb.pgPool ??
  new Pool({
    connectionString: databaseUrl,
    ...(databaseSsl ? { ssl: databaseSsl } : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgPool = db;
}
