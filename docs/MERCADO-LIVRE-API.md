# 🔥 API Mercado Livre - Documentação Profissional

## 📋 Visão Geral

Sistema **robusto e otimizado** para buscar produtos do Mercado Livre usando apenas a **API oficial**, sem dependency de scraping.

### ✅ O que é suportado

- ✅ Links completos: `https://www.mercadolivre.com.br/produto-xyz-MLB123456789`
- ✅ Links curtos: `https://meli.la/XXXXXX`
- ✅ Busca por ID: `MLB123456789`
- ✅ Redirects automáticos (meli.la → URL completa)
- ✅ Cache de 10 minutos (em memória ou Redis)
- ✅ Retry automático com backoff
- ✅ Timeout configurável (15s padrão)
- ✅ Log estruturado
- ✅ Tratamento robusto de erros (403, 404, timeout, etc)

## 📦 Instalação

### 1. Dependência já adicionada

O `axios` foi adicionado ao `package.json`:

```bash
npm install
```

### 2. Arquivos criados

```
lib/products/
├── mercadoLivreApi.ts      ← Core da API (principal)
├── exemplos-uso.ts         ← Exemplos práticos
app/api/
└── productos/mercadolivre/
    └── route.ts            ← Endpoint GET/POST
```

## 🚀 Como Usar

### Opção 1: Importar diretamente

```typescript
import { getProductFromLink, getProductById } from "@/lib/products/mercadoLivreApi";

// Buscar por link
const result = await getProductFromLink("https://meli.la/XXXXX");

if ("error" in result && result.error) {
  console.error(result.message);
} else {
  console.log(result.title);
  console.log(result.price);
}
```

### Opção 2: Via endpoint de API

**GET** - Com parâmetro de query:

```bash
GET /api/productos/mercadolivre?link=https://meli.la/XXXXX
GET /api/productos/mercadolivre?id=MLB123456789
```

**POST** - Com JSON:

```bash
POST /api/productos/mercadolivre
Content-Type: application/json

{
  "link": "https://meli.la/XXXXX"
}
```

## 📊 Estrutura de Resposta

### ✅ Sucesso (200)

```json
{
  "id": "MLB123456789",
  "title": "Receptor Amplificador Som Home Theater",
  "price": 299.90,
  "currency": "BRL",
  "thumbnail": "https://...",
  "image": "https://...",
  "permalink": "https://www.mercadolivre.com.br/...",
  "seller": {
    "id": 123456,
    "name": "Loja XYZ"
  },
  "stock": 15,
  "condition": "new",
  "description": "Descrição completa do produto..."
}
```

### ❌ Erro (400/500)

```json
{
  "error": true,
  "code": "INVALID_URL",
  "message": "Link não é do Mercado Livre",
  "status": 400
}
```

## 🎯 Códigos de Erro

| Código | HTTP | Significado |
|--------|------|-------------|
| `INVALID_URL` | 400 | Link vazio ou inválido |
| `NOT_MERCADOLIVRE_URL` | 400 | URL não é do Mercado Livre |
| `PRODUCT_ID_NOT_FOUND` | 400 | Não conseguiu extrair ID |
| `PRODUCT_NOT_FOUND` | 404 | Produto não existe na API |
| `ACCESS_DENIED` | 403 | Acesso bloqueado (IP, rate limit) |
| `FETCH_FAILED` | 500 | Erro na requisição à API |
| `SERVER_ERROR` | 500 | Erro desconhecido |

## 🔧 Configuração

Editar em `lib/products/mercadoLivreApi.ts`:

```typescript
// Timeout da requisição (ms)
const MERCADO_LIVRE_TIMEOUT_MS = 15000;

// Número de tentativas de retry
const MAX_RETRIES = 3;

// Delay entre retries (ms)
const RETRY_DELAY_MS = 1000;

// TTL do cache (ms) - 10 minutos
const CACHE_TTL_MS = 10 * 60 * 1000;
```

## 💾 Cache

### Verificar cache

```typescript
import { getCacheStats } from "@/lib/products/mercadoLivreApi";

const stats = getCacheStats();
console.log(stats); // { size: 5, entries: ['MLB123...', 'MLB456...'] }
```

### Limpar cache

```typescript
import { clearCache } from "@/lib/products/mercadoLivreApi";

clearCache(); // Remove todos os itens do cache
```

## 🧪 Exemplos Completos

### Exemplo 1: Busca simples

```typescript
import { getProductFromLink } from "@/lib/products/mercadoLivreApi";

const product = await getProductFromLink("https://meli.la/AbCdEf");

console.log(product);
// {
//   id: "MLB123456789",
//   title: "Produto...",
//   price: 299.90,
//   ...
// }
```

### Exemplo 2: Com tratamento de erro

```typescript
const result = await getProductFromLink("https://meli.la/INVALID");

if ("error" in result && result.error) {
  console.error(`[${result.code}] ${result.message}`);
} else {
  console.log(`${result.title} - R$ ${result.price}`);
}
```

### Exemplo 3: Em componente React

```typescript
"use client";

import { useState } from "react";

export default function SearchProduct() {
  const [link, setLink] = useState("");
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    setLoading(true);
    setError("");

    const response = await fetch(`/api/productos/mercadolivre`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link }),
    });

    const data = await response.json();

    if (data.error) {
      setError(data.message);
    } else {
      setProduct(data);
    }

    setLoading(false);
  };

  return (
    <div>
      <input
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder="Cole o link do Mercado Livre..."
      />
      <button onClick={handleSearch} disabled={loading}>
        {loading ? "Carregando..." : "Buscar"}
      </button>

      {error && <p style={{ color: "red" }}>{error}</p>}
      {product && (
        <div>
          <h3>{product.title}</h3>
          <p>R$ {product.price}</p>
          <img src={product.image} />
        </div>
      )}
    </div>
  );
}
```

### Exemplo 4: Em rota de API

```typescript
// app/api/meu-endpoint/route.ts

import { getProductFromLink } from "@/lib/products/mercadoLivreApi";

export async function GET(req: NextRequest) {
  const link = req.nextUrl.searchParams.get("link");

  const product = await getProductFromLink(link);

  return NextResponse.json(product);
}
```

## ⚡ Performance & Otimizações

### 🚀 Velocidade

- **Primeira requisição**: ~500-1500ms (com chamada à API + dados do seller + descrição)
- **Requisições subsequentes**: ~1ms (cache in-memory)

### 💾 Reduzir carga

Se quer buscar MUITOS produtos, considere usar Redis:

```typescript
// Substituir Map por Redis
const redis = new Redis();

function readFromCache(productId: string) {
  return redis.get(productId); // ou redis.getex() com TTL
}

function writeToCache(productId: string, data) {
  redis.setex(productId, CACHE_TTL_MS / 1000, JSON.stringify(data));
}
```

## 🛡️ Tratamento de Rate Limit

Se receber erro `403 ou 429`:

```typescript
// Increase retry delay
const RETRY_DELAY_MS = 5000; // 5 segundos

// ou implementar exponential backoff
const waitTime = Math.pow(2, attempt) * 1000;
```

## 📝 Logger

Os logs aparecem no console com prefixo `[MELI]`:

```
[MELI] Expandindo URL: https://meli.la/AbCd
[MELI] URL expandida: https://www.mercadolivre.com.br/...
[MELI] Buscando produto MLB123456789 (tentativa 1/3)
[MELI] Produto encontrado: Receptor Amplificador...
[MELI] Produto MLB123456789 armazenado em cache
```

## 🔍 Debugging

Para debug detalhado, adicione logs:

```typescript
// Em qualquer arquivo que use a API
const result = await getProductFromLink(link);

console.log("Status:", "error" in result ? result.status : 200);
console.log("Cache stats:", getCacheStats());
```

## 📚 Links Úteis

- [API Mercado Livre - Documentação](https://developers.mercadolibre.com.ar/es_ar/items-y-listings)
- [Axios - Request timeout](https://axios-http.com/docs/req_config)
- [Random user agents](https://www.useragentstring.com/)

## 🤝 Suporte

Se tiver problemas:

1. Verifique a URL do Mercado Livre é válida
2. Verifique se o produto existe
3. Verifique os logs no console
4. Teste o ID direto: `getProductById("MLB123456789")`
5. Limpe o cache: `clearCache()`

---

**Criado com ❤️ - v1.0 - Robusta e Profissional**
