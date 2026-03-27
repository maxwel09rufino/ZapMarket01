/**
 * 🧪 TESTE DA API MERCADO LIVRE
 * 
 * Execute com: npx ts-node lib/products/test-api.ts
 * ou importe e execute os testes em seu ambiente
 */

import { getProductFromLink, getProductById, clearCache } from "./mercadoLivreApi";

async function runTests() {
  console.log("🧪 ===== INICIANDO TESTES =====\n");

  // Teste 1: URL inválida
  console.log("📌 Teste 1: URL inválida");
  const test1 = await getProductFromLink("");
  console.log("Resultado:", "error" in test1 ? test1.message : "Erro inesperado\n");

  // Teste 2: URL não-Mercado Livre
  console.log("📌 Teste 2: URL não-Mercado Livre");
  const test2 = await getProductFromLink("https://www.google.com");
  console.log("Resultado:", "error" in test2 ? test2.message : "Erro inesperado\n");

  // Teste 3: ID inválido (produto não existe)
  console.log("📌 Teste 3: ID inválido (produto não existe)");
  const test3 = await getProductById("MLB000000000");
  console.log("Resultado:", "error" in test3 ? test3.message : "Erro inesperado\n");

  // Teste 4: Link válido (necessário substituis por um link real)
  console.log("📌 Teste 4: Link válido do Mercado Livre");
  console.log("⚠️  Nota: Substitua pelo link de um produto real");
  const test4 = await getProductFromLink(
    "https://www.mercadolivre.com.br/test-placeholder",
  );
  console.log("Resultado:", "error" in test4 ? test4.message : JSON.stringify(test4, null, 2));

  console.log("\n✅ Testes finalizado!");
}

// Executar se for arquivo principal
if (require.main === module) {
  runTests().catch(console.error);
}

export { runTests };
