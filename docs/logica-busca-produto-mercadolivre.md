# Logica de busca de produto por link (Mercado Livre)

Este documento descreve a logica usada no backend para transformar um link de produto (ex.: `meli.la/...` ou `mercadolivre.com.br/...`) em um payload pronto para a pagina de produtos.

Arquivo principal:
- `lib/products/mercadoLivre.ts`

Endpoint que usa essa logica:
- `POST /api/products/fetch` em `app/api/products/fetch/route.ts`

## Objetivo

Receber uma URL e retornar um objeto no formato usado pelo dashboard:
- `title`
- `price`
- `originalPrice` (opcional)
- `discount` (opcional)
- `hasCouponOrDiscount`
- `image`
- `images`
- `description`
- `link`
- `marketplace` (`mercadolivre`)
- `seller` (opcional)

## Fluxo completo

1. Sanitizacao e validacao basica
- Remove espacos no inicio/fim da URL.
- Valida protocolo (`http`/`https`).
- Valida host permitido (`meli.la`, `mercadolivre.com`, `mercadolivre.com.br`).
- Se falhar, retorna erro: `Produto nao encontrado ou link invalido.`

2. Cache em memoria
- Chave por URL normalizada (`url:...`).
- Chave por item (`item:MLB...`) quando possivel.
- TTL: 10 minutos.
- Se encontrar no cache, retorna imediatamente.

3. Resolucao de `itemId` (`MLB...`)
- Tenta extrair direto da URL recebida.
- Se nao vier na URL, tenta:
  - redirecionamento HTTP (`location`)
  - URL final carregada
  - URL canonica no HTML
  - JSON-LD da pagina
  - padroes `item_id/itemId/target_item_id` no HTML

4. Tentativa principal via API do Mercado Livre
- Busca item em `https://api.mercadolibre.com/items/{itemId}`.
- Busca descricao em `.../items/{itemId}/description`.
- Busca vendedor em `.../users/{seller_id}`.
- Mapeia para o payload interno.
- Se der certo, salva em cache e retorna.

5. Fallback por scraping (quando API falha/bloqueia/instavel)
- Carrega pagina HTML com headers de navegador.
- Extrai dados por JSON-LD e meta tags:
  - titulo (`og:title`, `twitter:title`, `h1`, `title`)
  - descricao (`og:description`, `description`)
  - preco (`itemprop=price`, `product:price:amount`, `og:price:amount`, fallback regex)
  - imagem (`og:image`, `twitter:image`, lista de imagens `mlstatic`)
- Detecta promocao/cupom por sinais no HTML.
- Extrai vendedor por `seller_name` e/ou `brand` do JSON-LD.

6. Tratamento especial para links sociais (`/social/...`)
- Esse e o ponto chave para links `meli.la` de afiliado.
- Quando a URL final cai em pagina social:
  - extrai o `itemId` mais provavel no HTML.
  - extrai tambem URLs reais de produto que aparecem dentro da pagina social.
  - pontua candidatos e escolhe o melhor (ex.: rotas com `/up/`, `pdp_filters=item_id`, `wid=MLB...`, correspondencia com `itemId` preferido).
  - faz nova tentativa de scraping na URL de produto escolhida.
  - se nao houver URL de produto boa, usa fallback antigo `https://www.mercadolivre.com.br/p/MLB...`.

7. Tratamento especial para landing intermedia de afiliado
- Quando a pagina retornada nao e a pagina real do produto, o backend procura no HTML um link com as classes:
  - `poly-component__link`
  - `poly-component__link--action-link`
- Se esse link tiver o texto `Ir para produto`, o sistema extrai o `href` e passa a usar essa URL como link real do produto.
- Essa resolucao acontece antes das heuristicas finais de `itemId` e antes do scraping definitivo, para o fluxo continuar normalmente com a URL correta.

8. Link retornado
- Se o link original for afiliado e valido, ele e preservado como `link` no retorno final.
- Isso garante que a pagina use o mesmo link que o usuario informou.

## Regras de erro e status

- `400`: link invalido, formato ruim, host nao permitido, ou nao foi possivel encontrar produto.
- `404`: produto nao encontrado na fonte consultada.
- `422`: link identificado como pagina social sem produto resolvivel.

No endpoint `POST /api/products/fetch`, esses erros sao convertidos para JSON:
- `{ "error": "..." }`

## Por que acontecia `POST /api/products/fetch 404`

Em alguns links `meli.la`, a pagina social tinha varios itens e o fallback apenas com `https://www.mercadolivre.com.br/p/MLB...` podia nao representar um URL valido para aquele item.

Com o ajuste, o parser agora tenta primeiro extrair e seguir o URL real do produto dentro da pagina social, reduzindo bastante os `404` nesses cenarios.

## Exemplo validado

Link:
- `https://meli.la/1spEDiM`

Resultado apos ajuste:
- `HTTP 200` em `POST /api/products/fetch`
- Produto retornado com `title`, `price`, `image`, `seller`, `description`, etc.
