import { ensureActiveMeliCredentialAccessToken } from "@/lib/meli/store";
import { resolveDirectProductUrlFromAffiliateLanding } from "@/lib/products/mercadoLivre";

const SHORT_LINK_UNSUPPORTED_TTL_MS = 15 * 60 * 1000;

type ShortenerCapabilityState = {
  status: "unknown" | "supported" | "unsupported";
  checkedAt?: number;
};

const globalForMeliAffiliate = globalThis as typeof globalThis & {
  mercadoLivreShortenerCapability?: ShortenerCapabilityState;
};

const shortenerCapability =
  globalForMeliAffiliate.mercadoLivreShortenerCapability ??
  (globalForMeliAffiliate.mercadoLivreShortenerCapability = {
    status: "unknown",
  });

export type MercadoLivreResolvedLinks = {
  link: string;
  linkOriginal: string;
  linkAffiliate?: string;
  linkShort?: string;
};

type ResolveMercadoLivreLinksInput = {
  userId?: string;
  link?: string;
  linkOriginal?: string;
  linkAffiliate?: string;
  linkShort?: string;
  canonicalLink?: string;
};

function sanitizeText(value: string | undefined | null) {
  return String(value ?? "").trim();
}

function isMercadoLivreUrl(rawUrl: string | undefined | null) {
  const normalized = sanitizeText(rawUrl);
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "meli.la" ||
      host.endsWith(".meli.la") ||
      host === "mercadolivre.com" ||
      host.endsWith(".mercadolivre.com") ||
      host === "mercadolivre.com.br" ||
      host.endsWith(".mercadolivre.com.br") ||
      host === "mercadolibre.com" ||
      host.endsWith(".mercadolibre.com")
    );
  } catch {
    return false;
  }
}

export function isMercadoLivreShortLink(rawUrl: string | undefined | null) {
  const normalized = sanitizeText(rawUrl);
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (host === "meli.la" || host.endsWith(".meli.la")) {
      return true;
    }

    return (
      (host === "mercadolivre.com" ||
        host.endsWith(".mercadolivre.com") ||
        host === "mercadolivre.com.br" ||
        host.endsWith(".mercadolivre.com.br")) &&
      pathname.startsWith("/sec/")
    );
  } catch {
    return false;
  }
}

function isMercadoLivreSocialLink(rawUrl: string | undefined | null) {
  const normalized = sanitizeText(rawUrl);
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    return parsed.pathname.toLowerCase().startsWith("/social/");
  } catch {
    return false;
  }
}

function isMercadoLivreAffiliateLink(rawUrl: string | undefined | null) {
  const normalized = sanitizeText(rawUrl);
  if (!normalized || !isMercadoLivreUrl(normalized)) {
    return false;
  }

  if (isMercadoLivreShortLink(normalized) || isMercadoLivreSocialLink(normalized)) {
    return true;
  }

  try {
    const parsed = new URL(normalized);
    return (
      sanitizeText(parsed.searchParams.get("matt_tool")).length > 0 ||
      sanitizeText(parsed.searchParams.get("matt_word")).length > 0 ||
      sanitizeText(parsed.searchParams.get("ref")).length > 0
    );
  } catch {
    return false;
  }
}

function stripAffiliateParams(rawUrl: string | undefined | null) {
  const normalized = sanitizeText(rawUrl);
  if (!normalized) {
    return "";
  }

  try {
    const parsed = new URL(normalized);

    for (const key of ["matt_tool", "matt_word", "ref", "forceInApp"]) {
      parsed.searchParams.delete(key);
    }

    if (parsed.searchParams.toString().length === 0) {
      parsed.search = "";
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function isResolvableDirectProductLink(rawUrl: string | undefined | null) {
  const normalized = sanitizeText(rawUrl);
  return (
    isMercadoLivreUrl(normalized) &&
    !isMercadoLivreShortLink(normalized) &&
    !isMercadoLivreSocialLink(normalized)
  );
}

async function resolveMercadoLivreIntermediaryProductLink(rawUrl: string | undefined | null) {
  const normalized = sanitizeText(rawUrl);
  if (!normalized || (!isMercadoLivreShortLink(normalized) && !isMercadoLivreSocialLink(normalized))) {
    return undefined;
  }

  try {
    console.info("[MELI_LINK_RESOLVER] Link meli.la recebido:", normalized);

    const resolvedUrl = await resolveDirectProductUrlFromAffiliateLanding(normalized);
    const strippedResolvedUrl = stripAffiliateParams(resolvedUrl);
    if (!isResolvableDirectProductLink(strippedResolvedUrl)) {
      return undefined;
    }

    console.info("[MELI_LINK_RESOLVER] Link real extraido:", strippedResolvedUrl);
    return strippedResolvedUrl;
  } catch (error) {
    console.warn(
      "[MELI_LINK_RESOLVER] Falha ao resolver pagina intermediaria do Mercado Livre.",
      error instanceof Error ? error.message : String(error),
    );
    return undefined;
  }
}

function buildAffiliateLink(
  rawUrl: string,
  config: {
    affiliateTrackingId?: string;
    affiliateSlug?: string;
  },
) {
  const normalizedUrl = stripAffiliateParams(rawUrl);
  if (!normalizedUrl) {
    return undefined;
  }

  const affiliateTrackingId = sanitizeText(config.affiliateTrackingId);
  if (!affiliateTrackingId) {
    return undefined;
  }

  try {
    const parsed = new URL(normalizedUrl);
    parsed.searchParams.set("matt_tool", affiliateTrackingId);

    const affiliateSlug = sanitizeText(config.affiliateSlug);
    if (affiliateSlug) {
      parsed.searchParams.set("matt_word", affiliateSlug);
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function resolveShortenerCapabilityStatus() {
  if (
    shortenerCapability.status === "unsupported" &&
    shortenerCapability.checkedAt &&
    Date.now() - shortenerCapability.checkedAt > SHORT_LINK_UNSUPPORTED_TTL_MS
  ) {
    shortenerCapability.status = "unknown";
    shortenerCapability.checkedAt = undefined;
  }

  return shortenerCapability.status;
}

async function tryGenerateMercadoLivreShortLink(linkAffiliate: string, accessToken: string) {
  if (!sanitizeText(linkAffiliate) || !sanitizeText(accessToken)) {
    return undefined;
  }

  if (resolveShortenerCapabilityStatus() === "unsupported") {
    return undefined;
  }

  const response = await fetch("https://api.mercadolibre.com/short_url", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      url: linkAffiliate,
    }),
  });

  if ([404, 405].includes(response.status)) {
    shortenerCapability.status = "unsupported";
    shortenerCapability.checkedAt = Date.now();
    return undefined;
  }

  if (!response.ok) {
    shortenerCapability.status = "unknown";
    shortenerCapability.checkedAt = Date.now();
    return undefined;
  }

  shortenerCapability.status = "supported";
  shortenerCapability.checkedAt = Date.now();

  const payload = (await response.json().catch(() => null)) as
    | {
        short_url?: string;
        shortUrl?: string;
        url?: string;
        short?: string;
        data?:
          | {
              short_url?: string;
              shortUrl?: string;
              url?: string;
            }
          | null;
      }
    | null;

  const shortLinkCandidates = [
    payload?.short_url,
    payload?.shortUrl,
    payload?.short,
    payload?.url,
    payload?.data?.short_url,
    payload?.data?.shortUrl,
    payload?.data?.url,
  ]
    .map((value) => sanitizeText(value))
    .filter((value) => value.length > 0);

  return shortLinkCandidates.find((value) => isMercadoLivreShortLink(value));
}

export async function resolveMercadoLivreProductLinks(
  input: ResolveMercadoLivreLinksInput,
): Promise<MercadoLivreResolvedLinks> {
  const rawLink = sanitizeText(input.link);
  const explicitOriginalLink = sanitizeText(input.linkOriginal);
  const explicitAffiliateLink = sanitizeText(input.linkAffiliate);
  const explicitShortLink = sanitizeText(input.linkShort);
  const canonicalLink = sanitizeText(input.canonicalLink);
  const directOriginalCandidate = [
    canonicalLink,
    explicitOriginalLink,
    rawLink,
    explicitAffiliateLink,
    explicitShortLink,
  ].find((candidate) => isResolvableDirectProductLink(candidate));
  let resolvedIntermediaryOriginalLink = "";

  if (!directOriginalCandidate) {
    for (const candidate of [
      canonicalLink,
      explicitOriginalLink,
      rawLink,
      explicitAffiliateLink,
      explicitShortLink,
    ]) {
      const resolvedCandidate = await resolveMercadoLivreIntermediaryProductLink(candidate);
      if (resolvedCandidate) {
        resolvedIntermediaryOriginalLink = resolvedCandidate;
        break;
      }
    }
  }

  const preferredOriginalCandidate =
    sanitizeText(directOriginalCandidate) ||
    resolvedIntermediaryOriginalLink ||
    stripAffiliateParams(explicitOriginalLink) ||
    stripAffiliateParams(rawLink) ||
    explicitOriginalLink ||
    rawLink ||
    explicitAffiliateLink ||
    explicitShortLink;

  const linkOriginal = sanitizeText(preferredOriginalCandidate) || rawLink;
  let generatedAffiliateLink =
    isMercadoLivreAffiliateLink(explicitAffiliateLink) &&
    !isMercadoLivreShortLink(explicitAffiliateLink)
    ? explicitAffiliateLink
    : undefined;
  let linkShort = isMercadoLivreShortLink(explicitShortLink) ? explicitShortLink : undefined;

  if (
    !generatedAffiliateLink &&
    isMercadoLivreAffiliateLink(rawLink) &&
    !isMercadoLivreShortLink(rawLink)
  ) {
    generatedAffiliateLink = rawLink;
  }

  if (!linkShort && isMercadoLivreShortLink(explicitAffiliateLink)) {
    linkShort = explicitAffiliateLink;
  }

  if (!linkShort && isMercadoLivreShortLink(rawLink)) {
    linkShort = rawLink;
  }

  if (!isMercadoLivreUrl(linkOriginal)) {
    return {
      link: linkShort || linkOriginal || rawLink,
      linkOriginal: linkOriginal || rawLink,
      linkAffiliate: generatedAffiliateLink || explicitAffiliateLink || undefined,
      linkShort,
    };
  }

  if ((!generatedAffiliateLink || !linkShort) && sanitizeText(linkOriginal)) {
    const auth = await ensureActiveMeliCredentialAccessToken(input.userId).catch(() => null);
    const affiliateTrackingId = sanitizeText(auth?.credential.affiliateTrackingId);
    const affiliateSlug = sanitizeText(auth?.credential.affiliateSlug);

    if (!generatedAffiliateLink && affiliateTrackingId) {
      generatedAffiliateLink = buildAffiliateLink(linkOriginal, {
        affiliateTrackingId,
        affiliateSlug,
      });
    }

    const accessToken = sanitizeText(auth?.accessToken);
    if (!linkShort && generatedAffiliateLink && accessToken) {
      try {
        linkShort = await tryGenerateMercadoLivreShortLink(generatedAffiliateLink, accessToken);
      } catch {
        linkShort = undefined;
      }
    }
  }

  return {
    link: linkShort || linkOriginal || rawLink,
    linkOriginal: linkOriginal || generatedAffiliateLink || linkShort || rawLink,
    linkAffiliate: generatedAffiliateLink || undefined,
    linkShort,
  };
}
