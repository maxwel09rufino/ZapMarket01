# 🚀 QUICK START - Em 5 Minutos

---

## ⏱️ Passo 1: Instalar Dependância (1 min)

```bash
npm install
```

✅ Feito! O Axios já foi adicionado ao `package.json`

---

## 🔍 Passo 2: Testar a API (1 min)

### Opção A: Via Terminal (Recomendado)

```bash
# GET com link
curl "http://localhost:3000/api/productos/mercadolivre?link=https://www.mercadolivre.com.br/receptor-amplificador-som-mlb12345678"

# GET com ID
curl "http://localhost:3000/api/productos/mercadolivre?id=MLB12345678"
```

### Opção B: Via JavaScript

```javascript
// No seu navegador (dev tools)
fetch('/api/productos/mercadolivre?link=https://meli.la/test')
  .then(r => r.json())
  .then(d => console.log(d))
```

### Opção C: Via Postman

```
GET http://localhost:3000/api/productos/mercadolivre?link=https://meli.la/test
```

---

## 💻 Passo 3: Usar no Seu Código (2 min)

### Opção 1: TypeScript (Recomendado)

```typescript
import { getProductFromLink } from "@/lib/products/mercadoLivreApi";

export default async function MyComponent() {
  const product = await getProductFromLink("https://meli.la/XXXXX");

  if ("error" in product && product.error) {
    return <p>Erro: {product.message}</p>;
  }

  return (
    <div>
      <h2>{product.title}</h2>
      <p>R$ {product.price}</p>
      <img src={product.image} alt={product.title} />
    </div>
  );
}
```

### Opção 2: Via Servidor (Server Action)

```typescript
"use server";

import { getProductFromLink } from "@/lib/products/mercadoLivreApi";

export async function buscarProduto(link: string) {
  return await getProductFromLink(link);
}
```

```typescript
// Cliente
"use client";

import { buscarProduto } from "./actions";

export default function Form() {
  const [product, setProduct] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const result = await buscarProduto(e.target.link.value);
    setProduct(result);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input name="link" placeholder="Cole o link..." />
      <button>Buscar</button>
      {product && <ProductCard {...product} />}
    </form>
  );
}
```

### Opção 3: Via API Route

```typescript
// app/meu-endpoint/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getProductFromLink } from "@/lib/products/mercadoLivreApi";

export async function GET(req: NextRequest) {
  const link = req.nextUrl.searchParams.get("link");
  const product = await getProductFromLink(link || "");
  return NextResponse.json(product);
}
```

---

## 🎯 Passo 4: Entender a Resposta (1 min)

### ✅ Sucesso (Status: 200)

```json
{
  "id": "MLB123456789",
  "title": "Receptor Amplificador Som Home Theater 5.1",
  "price": 299.90,
  "currency": "BRL",
  "thumbnail": "https://...",
  "image": "https://...",
  "permalink": "https://www.mercadolivre.com.br/...",
  "seller": {
    "id": 123456789,
    "name": "Loja Eletrônicos XYZ"
  },
  "stock": 15,
  "condition": "new",
  "description": "Descrição completa do produto aqui..."
}
```

### ❌ Erro (Status: 400/404/500)

```json
{
  "error": true,
  "code": "PRODUCT_NOT_FOUND",
  "message": "Produto não encontrado",
  "status": 404
}
```

---

## 🎁 Bônus: Funções Extras

### Buscar por ID

```typescript
import { getProductById } from "@/lib/products/mercadoLivreApi";

const product = await getProductById("MLB123456789");
```

### Buscar Múltiplos

```typescript
import { importMultipleProducts } from "@/lib/products/integracao";

const { successful, failed } = await importMultipleProducts([
  "https://meli.la/link1",
  "https://meli.la/link2",
  "https://meli.la/link3",
]);

console.log(`✅ ${successful.length} produtos`);
console.log(`❌ ${failed.length} falharam`);
```

### Limpar Cache

```typescript
import { clearCache, getCacheStats } from "@/lib/products/mercadoLivreApi";

// Ver stats
console.log(getCacheStats()); // { size: 5, entries: [...] }

// Limpar
clearCache();
```

---

## 📚 Próximo: Documentação Completa

Pronto para mergulhar fundo? Leia:

👉 **[docs/MERCADO-LIVRE-API.md](../docs/MERCADO-LIVRE-API.md)**

Quer exemplos? Veja:

👉 **[lib/products/exemplos-uso.ts](../lib/products/exemplos-uso.ts)**

---

## 🐛 Troubleshooting

### ❌ "axios não encontrado"
```bash
npm install  # Reinstale as dependências
```

### ❌ "404 Not Found no produto"
- Verifique se a URL é válida
- Tente com um ID conhecido: `MLB123456789`

### ❌ "Timeout"
- Verifique sua conexão
- Tente novamente (retry é automático)

### ❌ "Status 403"
- Pode ser rate limit
- Aguarde alguns minutos

---

## ✅ Você Pode Fazer Já!

```typescript
// 1. Buscar um produto
const product = await getProductFromLink("https://meli.la/teste");

// 2. Validar resultado
if ("error" in product && product.error) {
  console.error("Erro:", product.message);
} else {
  console.log("✅ Produto:", product.title);
}

// 3. Usar em componente React
// 4. Salvar em banco de dados
// 5. Enviar para outra API
// 6. Tudo funciona!
```

---

## 🎓 Estrutura de Diretórios

```
lib/products/
├── mercadoLivreApi.ts       ← CORE (use isso)
├── integracao.ts            ← Integração com seu sistema
├── exemplos-uso.ts          ← 7 exemplos
└── test-api.ts              ← Testes

app/api/productos/mercadolivre/
└── route.ts                 ← Endpoint GET/POST

docs/
└── MERCADO-LIVRE-API.md     ← Full documentation
```

---

## 🔗 Links Úteis

- [📖 API Completa](../docs/MERCADO-LIVRE-API.md)
- [🧪 Exemplos](../lib/products/exemplos-uso.ts)
- [🔗 Integração](../lib/products/integracao.ts)
- [✅ Validação](../VALIDACAO-MERCADO-LIVRE.md)

---

## 🎬 Divirta-se!

Você tem tudo que precisa para começar. 

**Código:** ✅  
**Documentação:** ✅  
**Exemplos:** ✅  
**Endpoints:** ✅  

**Agora é com você! 🚀**

---

**Em caso de dúvidas → Veja a documentação completa**

**Em caso de bugs → Verifique os exemplos**

**Em caso de sucesso → Compartilhe a alegria! 🎉**
