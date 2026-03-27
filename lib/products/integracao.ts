/**
 * 🔗 INTEGRAÇÃO - API Mercado Livre Robusta com Sistema Existente
 * 
 * Este arquivo mostra como integrar a nova API com o sistema
 * de importação de produtos existente.
 */

import {
  getProductFromLink,
  MercadoLivreProduct,
} from "./mercadoLivreApi";

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

/**
 * Tipo esperado pelo sistema de campanhas
 */
export interface ImportedProduct {
  marketplaceId: string;
  marketplace: "mercadolivre";
  title: string;
  price: number;
  originalPrice?: number;
  thumbnail: string;
  link: string;
  description?: string;
  seller?: {
    id: number;
    name: string;
  };
  stock: number;
  importedAt: Date;
}

/**
 * Converter resposta da API para o formato esperado
 */
function convertApiToImportedProduct(product: MercadoLivreProduct): ImportedProduct {
  return {
    marketplaceId: product.id,
    marketplace: "mercadolivre",
    title: product.title,
    price: product.price,
    originalPrice: undefined, // API não fornece, mas pode aprimorar depois
    thumbnail: product.thumbnail || product.image || "",
    link: product.permalink,
    description: product.description || undefined,
    seller: product.seller || undefined,
    stock: product.stock,
    importedAt: new Date(),
  };
}

/**
 * 🔥 Função principal - Usar como substituição no sistema
 * 
 * Pode ser usada em lugar de fetchMercadoLivreProductByUrl
 * ou complementá-la com fallback
 */
export async function importProductFromMercadoLivre(
  link: string,
): Promise<ImportedProduct | null> {
  try {
    const result = await getProductFromLink(link);

    if (isMercadoLivreApiError(result)) {
      console.error(`Erro ao importar: ${result.message}`);
      return null;
    }

    return convertApiToImportedProduct(result);
  } catch (error) {
    console.error("Erro crítico ao importar produto:", error);
    return null;
  }
}

/**
 * 🎯 Versão para batch - importar múltiplos produtos
 */
export async function importMultipleProducts(
  links: string[],
): Promise<{
  successful: ImportedProduct[];
  failed: { link: string; error: string }[];
}> {
  const successful: ImportedProduct[] = [];
  const failed: { link: string; error: string }[] = [];

  for (const link of links) {
    const product = await importProductFromMercadoLivre(link);

    if (product) {
      successful.push(product);
    } else {
      failed.push({
        link,
        error: "Não foi possível importar o produto",
      });
    }
  }

  return { successful, failed };
}

/**
 * 💾 Versão com fallback
 * 
 * Tenta nova API, se falhar tenta a antiga
 */
export async function importProductSmart(
  link: string,
  fallbackFunction?: (link: string) => Promise<ImportedProduct | null>,
): Promise<ImportedProduct | null> {
  try {
    // Tentar nova API
    const imported = await importProductFromMercadoLivre(link);

    if (imported) {
      return imported;
    }

    // Se falhar e houver fallback, usar
    if (fallbackFunction) {
      console.log("Tentando fallback para link:", link);
      const fallbackResult = await fallbackFunction(link);

      if (fallbackResult) {
        return fallbackResult;
      }
    }

    return null;
  } catch (error) {
    console.error("Erro em importProductSmart:", error);

    // Tentar fallback em último caso
    if (fallbackFunction) {
      try {
        return await fallbackFunction(link);
      } catch {
        return null;
      }
    }

    return null;
  }
}

/**
 * 🔁 Retry com políticas customizáveis
 */
export async function importProductWithPolicies(
  link: string,
  options?: {
    maxRetries?: number;
    delayMs?: number;
    fallback?: (link: string) => Promise<ImportedProduct | null>;
    timeout?: number;
  },
): Promise<ImportedProduct | null> {
  const maxRetries = options?.maxRetries ?? 3;
  const delayMs = options?.delayMs ?? 2000;
  const timeout = options?.timeout ?? 15000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `🔄 Tentativa ${attempt}/${maxRetries} - Importando: ${link}`,
      );

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), timeout),
      );

      const result = (await Promise.race([
        importProductFromMercadoLivre(link),
        timeoutPromise,
      ])) as ImportedProduct | null;

      if (result) {
        console.log(`✅ Sucesso na tentativa ${attempt}`);
        return result;
      }
    } catch (error) {
      console.error(`❌ Tentativa ${attempt} falhou:`, error);

      if (attempt < maxRetries) {
        console.log(`⏳ Aguardando ${delayMs}ms antes de retry...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // Se todas as tentativas falharem, tentar fallback
  if (options?.fallback) {
    console.log("Tentando fallback após falhas...");
    return await importProductSmart(link, options.fallback);
  }

  console.log(`❌ Falha em importar após ${maxRetries} tentativas`);
  return null;
}

/**
 * 📊 Validar lista de links antes de importar
 */
export async function validateAndImport(
  links: string[],
): Promise<{
  valid: { link: string; product: ImportedProduct }[];
  invalid: { link: string; reason: string }[];
}> {
  const valid: { link: string; product: ImportedProduct }[] = [];
  const invalid: { link: string; reason: string }[] = [];

  for (const link of links) {
    // Validações básicas
    if (!link || link.trim().length === 0) {
      invalid.push({ link, reason: "Link vazio" });
      continue;
    }

    if (!link.includes("mercadolivre") && !link.includes("meli.la")) {
      invalid.push({ link, reason: "Não é URL do Mercado Livre" });
      continue;
    }

    // Tentar importar
    const product = await importProductFromMercadoLivre(link);

    if (product) {
      valid.push({ link, product });
    } else {
      invalid.push({ link, reason: "Falha ao importar da API" });
    }
  }

  return { valid, invalid };
}

/**
 * 📈 Estatísticas de importação
 */
export interface ImportStats {
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  failedLinks: string[];
  averageImportTimeMs: number;
}

/**
 * 🎯 Importar com estatísticas
 */
export async function importWithStats(links: string[]): Promise<{
  products: ImportedProduct[];
  stats: ImportStats;
}> {
  const startTime = Date.now();
  const products: ImportedProduct[] = [];
  const failedLinks: string[] = [];

  for (const link of links) {
    const product = await importProductFromMercadoLivre(link);

    if (product) {
      products.push(product);
    } else {
      failedLinks.push(link);
    }
  }

  const endTime = Date.now();
  const successful = products.length;
  const failed = failedLinks.length;
  const total = links.length;

  const stats: ImportStats = {
    total,
    successful,
    failed,
    successRate: total > 0 ? (successful / total) * 100 : 0,
    failedLinks,
    averageImportTimeMs: total > 0 ? (endTime - startTime) / total : 0,
  };

  return { products, stats };
}

// ===== EXEMPLO DE USO =====

/*
import { 
  importProductFromMercadoLivre,
  importMultipleProducts, 
  importWithStats 
} from "@/lib/products/integracao";

// Usar em lugar da função antiga
const product = await importProductFromMercadoLivre("https://meli.la/XXXXX");

// Importar múltiplos
const { successful, failed } = await importMultipleProducts([
  "https://meli.la/Link1",
  "https://meli.la/Link2",
]);

// Com estatísticas
const { products, stats } = await importWithStats([
  "https://meli.la/Link1",
  "https://meli.la/Link2",
]);

console.log(`Importados ${stats.successful}/${stats.total} produtos`);
console.log(`Taxa: ${stats.successRate.toFixed(1)}%`);
*/

const mercadoLivreIntegration = {
  importProductFromMercadoLivre,
  importMultipleProducts,
  importProductSmart,
  importProductWithPolicies,
  validateAndImport,
  importWithStats,
};

export default mercadoLivreIntegration;
