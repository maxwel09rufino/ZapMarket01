import assert from "node:assert/strict";

const {
  buildMercadoLivreCatalogUrl,
  buildMercadoLivreItemUrl,
  extractMercadoLivreItemId,
  extractMercadoLivreItemIdFromUrl,
  getMercadoLivreProductMismatchReason,
  mercadoLivreLinkMatchesItemId,
  normalizeMercadoLivreItemId,
} = (await import(
  new URL("../lib/products/mercadoLivreLink.ts", import.meta.url).href
)) as typeof import("../lib/products/mercadoLivreLink");

function runTest(name: string, callback: () => void) {
  callback();
  console.log(`[ok] ${name}`);
}

runTest("normaliza IDs do Mercado Livre", () => {
  assert.equal(normalizeMercadoLivreItemId("mlb-123456789"), "MLB123456789");
  assert.equal(normalizeMercadoLivreItemId("MLB_123456789"), "MLB123456789");
  assert.equal(normalizeMercadoLivreItemId(""), null);
});

runTest("extrai ID do texto e da URL do produto", () => {
  assert.equal(extractMercadoLivreItemId("Produto MLB123456789"), "MLB123456789");
  assert.equal(
    extractMercadoLivreItemIdFromUrl(
      "https://produto.mercadolivre.com.br/MLB-123456789-kit-meias-cano-alto-_JM",
    ),
    "MLB123456789",
  );
});

runTest("extrai ID de links com wid e pdp_filters", () => {
  assert.equal(
    extractMercadoLivreItemIdFromUrl(
      "https://www.mercadolivre.com.br/social?wid=MLB123456789",
    ),
    "MLB123456789",
  );

  assert.equal(
    extractMercadoLivreItemIdFromUrl(
      "https://www.mercadolivre.com.br/p/MLB999999999?pdp_filters=item_id%3AMLB123456789",
    ),
    "MLB123456789",
  );
});

runTest("extrai ID de hash com item preferencial", () => {
  assert.equal(
    extractMercadoLivreItemIdFromUrl(
      "https://www.mercadolivre.com.br/anuncio#item=MLB123456789",
    ),
    "MLB123456789",
  );
});

runTest("monta a URL correta para item e catalogo", () => {
  assert.equal(
    buildMercadoLivreItemUrl("MLB123456789"),
    "https://produto.mercadolivre.com.br/MLB123456789",
  );
  assert.equal(
    buildMercadoLivreCatalogUrl("MLB123456789"),
    "https://www.mercadolivre.com.br/p/MLB123456789",
  );
});

runTest("reconhece quando o link retornado bate com o item esperado", () => {
  assert.equal(
    mercadoLivreLinkMatchesItemId(
      "https://produto.mercadolivre.com.br/MLB-123456789-kit-meias-cano-alto-_JM",
      "MLB123456789",
    ),
    true,
  );
});

runTest("detecta mismatch entre item pedido e produto retornado", () => {
  assert.equal(
    getMercadoLivreProductMismatchReason({
      expectedItemId: "MLB123456789",
      returnedItemId: "MLB123456789",
      permalink: "https://produto.mercadolivre.com.br/MLB-123456789-kit-meias-cano-alto-_JM",
    }),
    null,
  );

  assert.equal(
    getMercadoLivreProductMismatchReason({
      expectedItemId: "MLB123456789",
      returnedItemId: "MLB987654321",
      permalink: "https://produto.mercadolivre.com.br/MLB-987654321-outro-produto-_JM",
    }),
    "Produto retornado nao corresponde ao item MLB123456789.",
  );
});

console.log("Todos os testes do helper de links do Mercado Livre passaram.");
