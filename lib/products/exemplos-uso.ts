/**
 * 📚 EXEMPLOS DE USO - API Mercado Livre Robusta
 * 
 * Este arquivo demonstra como usar a nova API de busca de produtos
 * do Mercado Livre de forma robusta e profissional.
 */

import { getProductFromLink, getProductById, clearCache, getCacheStats } from "@/lib/products/mercadoLivreApi";

function isProductError(
  result: Awaited<ReturnType<typeof getProductFromLink>> | Awaited<ReturnType<typeof getProductById>>,
): result is {
  error: true;
  code: string;
  message: string;
  status?: number;
} {
  return "error" in result && result.error === true;
}

/**
 * ✅ EXEMPLO 1: Buscar por link completo
 */
async function exemplo1_linkCompleto() {
  const link = "https://www.mercadolivre.com.br/receptor-amplificador-som-home-theater/p/MLB123456789";

  const resultado = await getProductFromLink(link);

  if (isProductError(resultado)) {
    console.error("❌ Erro:", resultado.message);
  } else {
    console.log("✅ Produto encontrado:");
    console.log(`  Título: ${resultado.title}`);
    console.log(`  Preço: R$ ${resultado.price}`);
    console.log(`  Thumbnail: ${resultado.thumbnail}`);
  }
}

/**
 * ✅ EXEMPLO 2: Buscar por link encurtado (meli.la)
 */
async function exemplo2_linkEncurtado() {
  const link = "https://meli.la/AbCdEfGh"; // Link encurtado

  const resultado = await getProductFromLink(link);

  if (isProductError(resultado)) {
    console.error("❌ Erro:", resultado.message);
  } else {
    console.log("✅ Produto encontrado:");
    console.log(`  Título: ${resultado.title}`);
    console.log(`  Preço: R$ ${resultado.price}`);
  }
}

/**
 * ✅ EXEMPLO 3: Buscar por ID direto
 */
async function exemplo3_porId() {
  const productId = "MLB123456789";

  const resultado = await getProductById(productId);

  if (isProductError(resultado)) {
    console.error("❌ Erro:", resultado.message);
  } else {
    console.log("✅ Produto encontrado:");
    console.log(`  Título: ${resultado.title}`);
    console.log(`  Preço: R$ ${resultado.price}`);
    console.log(`  Vendedor: ${resultado.seller?.name || "Desconhecido"}`);
    console.log(`  Estoque: ${resultado.stock}`);
  }
}

/**
 * ✅ EXEMPLO 4: Tratamento de erros
 */
async function exemplo4_tratamentoErros() {
  const links = [
    "https://www.mercadolivre.com.br/123", // Produto não existe
    "https://www.google.com", // Não é Mercado Livre
    "", // Link vazio
    "https://meli.la/InvalidLink", // Link inválido
  ];

  for (const link of links) {
    console.log(`\n📌 Testando: ${link}`);
    const resultado = await getProductFromLink(link);

    if (isProductError(resultado)) {
      console.log(`  ❌ ${resultado.code}: ${resultado.message}`);
    } else {
      console.log(`  ✅ ${resultado.title}`);
    }
  }
}

/**
 * ✅ EXEMPLO 5: Usar em rota de API Next.js
 */
async function exemplo5_rotaApi() {
  // Simular requisição GET
  const response = await fetch(`http://localhost:3000/api/productos/mercadolivre?link=https://meli.la/XXXXX`);
  const data = await response.json();

  console.log("🔗 Resposta da API:", data);

  // Simular requisição POST
  const postResponse = await fetch(`http://localhost:3000/api/productos/mercadolivre`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      link: "https://www.mercadolivre.com.br/produto-teste",
    }),
  });

  const postData = await postResponse.json();
  console.log("📨 Resposta POST:", postData);
}

/**
 * ✅ EXEMPLO 6: Cache em ação
 */
async function exemplo6_cache() {
  const productId = "MLB123456789";

  console.log("📊 Stats iniciais:", getCacheStats());

  // Primeira requisição (vai pra API)
  console.log("\n⏳ Primeira busca (sem cache)...");
  const resultado1 = await getProductById(productId);
  console.log("✅ Resultado 1:", "title" in resultado1 ? resultado1.title : resultado1.message);

  // Segunda requisição (vem do cache)
  console.log("\n💾 Segunda busca (COM cache)...");
  const resultado2 = await getProductById(productId);
  console.log("✅ Resultado 2 (cache):", "title" in resultado2 ? resultado2.title : resultado2.message);

  console.log("\n📊 Stats finais:", getCacheStats());

  // Limpar cache
  clearCache();
  console.log("🗑️ Cache limpo!");
}

/**
 * ✅ EXEMPLO 7: Buscar com links de afiliado
 */
async function exemplo7_linksAfiliados() {
  const links = [
    "https://www.mercadolivre.com.br/receptor-amplificador-som?id=MLB123456789",
    "https://www.mercadolivre.com/p/MLB123456789", // Outro formato
    "https://produto.mercadolivre.com.br/MLB-123456789-", // Outro host
  ];

  for (const link of links) {
    console.log(`\n🔗 Testando: ${link}`);
    const resultado = await getProductFromLink(link);

    if (isProductError(resultado)) {
      console.log(`  ❌ ${resultado.message}`);
    } else {
      console.log(`  ✅ ${resultado.title} - R$ ${resultado.price}`);
    }
  }
}

/**
 * 🚀 EXECUÇÃO DE EXEMPLO
 */
async function rodaExemplos() {
  console.log("🔥 ===== EXEMPLOS DE USO =====\n");

  try {
    // Descomente o exemplo que deseja executar:
    // await exemplo1_linkCompleto();
    // await exemplo2_linkEncurtado();
    // await exemplo3_porId();
    await exemplo4_tratamentoErros();
    // await exemplo6_cache();
    // await exemplo7_linksAfiliados();
  } catch (error) {
    console.error("💥 Erro ao executar exemplo:", error);
  }
}

// Comentar isso quando for importar em outro arquivo
// rodaExemplos().catch(console.error);

export { exemplo1_linkCompleto, exemplo2_linkEncurtado, exemplo3_porId, exemplo4_tratamentoErros, exemplo6_cache, exemplo7_linksAfiliados };
