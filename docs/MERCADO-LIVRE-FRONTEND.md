# 🎨 FRONTEND MERCADO LIVRE - Guia Completo

---

## 📍 Localização

Tudo está em **Configurações**:

```
/app/configuracoes/page.tsx ← Página principal
  ├── MeliProductValidator ← Validar produtos
  └── MeliCredentialsManager ← Gerenciar credenciais
```

---

## 🎯 O Que Foi Criado

### 1️⃣ **Página de Configurações**
- `app/configuracoes/page.tsx`
- Interface limpa com 2 abas
- Design moderno com Tailwind CSS

### 2️⃣ **Validador de Produtos**
- `components/MeliProductValidator.tsx`
- Cole um link → valida em tempo real
- Mostra: preço, estoque, vendedor, imagem
- Histórico de validações
- Tempo de resposta

### 3️⃣ **Gerenciador de Credenciais**
- `components/MeliCredentialsManager.tsx`
- Adicionar credenciais OAuth
- Lista de credenciais ativas
- Remover credenciais
- Histórico auditável

### 4️⃣ **APIs**
- `/api/meli/credentials` → CRUD de credenciais
- `/api/meli/validate` → Validar produtos

### 5️⃣ **Banco de Dados**
- `database/meli-credentials.sql`
- 3 tabelas principais
- Índices para performance

---

## 🗂️ Arquivos Criados

```
app/
├── configuracoes/
│   └── page.tsx                    ← Página principal ⭐
├── api/
│   └── meli/
│       ├── credentials/
│       │   └── route.ts            ← API credenciais
│       └── validate/
│           └── route.ts            ← API validação
│
components/
├── MeliProductValidator.tsx        ← Validador
└── MeliCredentialsManager.tsx      ← Gerenciador

database/
└── meli-credentials.sql            ← Tabelas
```

---

## 🚀 Como Usar

### Passo 1: Executar SQL

```bash
# No seu terminal (psql)
psql -U seu_usuario -d seu_banco -f database/meli-credentials.sql

# Ou cole o conteúdo direto no seu gerenciador de BD
```

### Passo 2: Acessar Página

```
http://localhost:3000/configuracoes
```

### Passo 3: Testar

#### Opção A: Sem Credenciais (Teste Rápido)
1. Vá para "Validador de Produtos"
2. Cole um link do Mercado Livre
3. Clique "Validar"
4. ✅ Pronto!

#### Opção B: Com Credenciais
1. Vá para "Credenciais"
2. Clique "Adicionar Credencial"
3. Cole seus tokens OAuth
4. Salve
5. Use na validação

---

## 📱 Interface

### Aba 1: Validador de Produtos

```
┌─────────────────────────────────────────┐
│ Validar Produtos Mercado Livre          │
├─────────────────────────────────────────┤
│                                         │
│ Cole o Link do Produto *                │
│ ┌───────────────────┬────────────────┐  │
│ │ https://meli... │ [Validar]      │  │
│ └───────────────────┴────────────────┘  │
│                                         │
├─────────────────────────────────────────┤
│ ✅ Resultado da Validação               │
│                                         │
│ [Imagem]                                │
│ Produto: Receptor Amplificador          │
│ Preço: R$ 299,90                        │
│ Estoque: 15                             │
│ Vendedor: Loja XYZ                      │
│                                         │
├─────────────────────────────────────────┤
│ Histórico Recente:                      │
│ ✅ Produto 1 - R$ 100,00 - 125ms       │
│ ❌ Produto 2 - Erro - 450ms            │
│ ✅ Produto 3 - R$ 250,00 - 280ms       │
└─────────────────────────────────────────┘
```

### Aba 2: Credenciais

```
┌─────────────────────────────────────────┐
│ Credenciais Mercado Livre               │
│                              [+ Adicionar]
├─────────────────────────────────────────┤
│                                         │
│ ✅ Credencial 1                         │
│    ID: 123456789                        │
│    Nick: meu_usuario_ml                 │
│    Adicionado em: 20/03/2026            │
│    Único uso: 22/03/2026          [🗑️] │
│                                         │
│ ✅ Credencial 2                         │
│    ID: 987654321                        │
│    Nick: outro_usuario                  │
│    Adicionado em: 15/03/2026      [🗑️] │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🔌 APIs HTTP

### Credenciais

#### GET - Listar
```bash
curl "http://localhost:3000/api/meli/credentials" \
  -H "x-user-id: demo-user"
```

**Resposta:**
```json
{
  "credentials": [
    {
      "id": "abc123",
      "meli_user_id": "123456789",
      "meli_nickname": "meu_usuario_ml",
      "is_active": true,
      "last_used_at": "2026-03-22T10:30:00Z",
      "created_at": "2026-03-20T15:00:00Z"
    }
  ],
  "total": 1
}
```

#### POST - Adicionar
```bash
curl -X POST "http://localhost:3000/api/meli/credentials" \
  -H "Content-Type: application/json" \
  -H "x-user-id: demo-user" \
  -d '{
    "access_token": "YOUR_ACCESS_TOKEN",
    "refresh_token": "YOUR_REFRESH_TOKEN",
    "meli_user_id": "123456789",
    "meli_nickname": "meu_usuario"
  }'
```

#### DELETE - Remover
```bash
curl -X DELETE "http://localhost:3000/api/meli/credentials/abc123" \
  -H "x-user-id: demo-user"
```

### Validação

#### POST - Validar Produto
```bash
curl -X POST "http://localhost:3000/api/meli/validate" \
  -H "Content-Type: application/json" \
  -H "x-user-id: demo-user" \
  -d '{
    "product_link": "https://meli.la/XXXXX",
    "credential_id": null
  }'
```

**Resposta (Sucesso):**
```json
{
  "message": "✅ Produto validado com sucesso",
  "validation": {
    "id": "val123",
    "product_id": "MLB123456789",
    "title": "Receptor Amplificador Som",
    "price": 299.90,
    "currency": "BRL",
    "image_url": "https://...",
    "seller_name": "Loja XYZ",
    "stock": 15,
    "is_valid": true,
    "validation_status": "success",
    "response_time_ms": 385,
    "created_at": "2026-03-23T10:15:00Z"
  },
  "product": { ... }
}
```

**Resposta (Erro):**
```json
{
  "message": "❌ Erro ao validar produto",
  "validation": {
    "id": "val124",
    "product_link": "https://meli.la/INVALID",
    "is_valid": false,
    "error_message": "Produto não encontrado",
    "validation_status": "error",
    "response_time_ms": 125,
    "created_at": "2026-03-23T10:16:00Z"
  },
  "product": null
}
```

#### GET - Histórico
```bash
curl "http://localhost:3000/api/meli/validate?limit=10&offset=0" \
  -H "x-user-id: demo-user"
```

---

## 💾 Banco de Dados

### Tabelas

#### `meli_credentials`
```sql
id                 UUID PRIMARY KEY
user_id            UUID NOT NULL
access_token       TEXT NOT NULL
refresh_token      TEXT
token_type         TEXT DEFAULT 'Bearer'
expires_at         TIMESTAMPTZ
meli_user_id       TEXT
meli_nickname      TEXT
is_active          BOOLEAN DEFAULT true
created_at         TIMESTAMPTZ
updated_at         TIMESTAMPTZ
last_used_at       TIMESTAMPTZ
```

#### `meli_product_validations`
```sql
id                 UUID PRIMARY KEY
user_id            UUID NOT NULL
credential_id      UUID FOREIGN KEY
product_link       TEXT NOT NULL
product_id         TEXT
title              TEXT
price              NUMERIC
currency           TEXT
image_url          TEXT
seller_name        TEXT
stock              INTEGER
is_valid           BOOLEAN
error_message      TEXT
validation_status  TEXT (success, error, pending)
response_time_ms   INTEGER
created_at         TIMESTAMPTZ
```

#### `meli_credential_logs`
```sql
id                 UUID PRIMARY KEY
credential_id      UUID FOREIGN KEY
action             TEXT (created, updated, refreshed, revoked, error)
details            JSONB
error_message      TEXT
created_at         TIMESTAMPTZ
```

---

## 🎨 Componentes React

### MeliProductValidator
- **Props**: Nenhuma
- **Estado**: link, validations, lastValidation, loading, error
- **Função**: Validar produtos e manter histórico
- **Features**:
  - Upload/paste de link
  - Validação em tempo real
  - Histórico local
  - Tempo de resposta
  - Imagem do produto

### MeliCredentialsManager
- **Props**: Nenhuma
- **Estado**: credentials, loading, formData, submitting
- **Função**: Gerenciar credenciais OAuth
- **Features**:
  - Adicionar credenciais
  - Listar com status
  - Deletar com confirmação
  - Log de auditoria

---

## ⚙️ Configurações

### Headers Customizados
```typescript
// Usar x-user-id para identificar usuário
// TODO: Substituir por sessão real (NextAuth, etc)
headers: {
  "x-user-id": "demo-user"  // Trocar pela sessão real
}
```

### Timeout
```typescript
// No componente MeliProductValidator
const response = await fetch(..., {
  // Timeout padrão: sem tratamento específico
  // TODO: Adicionar AbortController para timeout real
});
```

---

## 🔐 Segurança

### ⚠️ TODO: Antes de Produção

1. **Autenticação Real**
   ```typescript
   // ❌ Antes:
   const userId = request.headers.get("x-user-id") || "demo-user";
   
   // ✅ Depois:
   const session = await getSession(request);
   if (!session) return NextResponse.json({error: "Unauthorized"}, {status: 401});
   const userId = session.user.id;
   ```

2. **Criptografia de Tokens**
   ```typescript
   // Usar biblioteca como crypto ou bcrypt
   const encrypted = await encrypt(access_token, SECRET_KEY);
   ```

3. **Rate Limiting**
   ```typescript
   // Implementar rate limit nas APIs
   // npm install express-rate-limit
   ```

4. **Validação de Entrada**
   ```typescript
   // Usar zod ou joi para validar dados
   ```

---

## 📊 Exemplo Completo: Fluxo de Uso

### Cenário: Validar 5 Produtos

```
1. Usuário acessa /configuracoes
   ↓
2. Clica em "Validador de Produtos"
   ↓
3. Cola link: https://meli.la/ABC123
   ↓
4. Clica "Validar"
   ↓
5. API chama getProductFromLink()
   ↓
6. Produto validado + armazenado no BD
   ↓
7. Resultado exibido na tela com:
   - Imagem do produto
   - Preço: R$ X,XX
   - Estoque: Y unidades
   - Vendedor: Nome
   - Tempo: 250ms
   ↓
8. Produto adicionado ao histórico
   ↓
9. Repete para outros produtos
```

---

## 🐛 Troubleshooting

### ❌ "Erro ao validar produto"
- Verifique se o link é válido
- Tente outro link
- Veja os logs do servidor

### ❌ "Erro ao adicionar credencial"
- Verifique se access_token está correto
- Verifique meli_user_id
- Veja os logs

### ❌ "PostgreSQL connection error"
- Verifique se BD está rodando
- Verifique DATABASE_URL em .env
- Verifique credenciais do BD

### ❌ Página não aparece
- Verifique se arquivo `configuracoes/page.tsx` existe
- Verifique imports dos componentes
- Reinicie o servidor Next.js

---

## 🔄 Próximos Passos Opcionais

1. **Autenticação via NextAuth**
2. **Criptografia de tokens no BD**
3. **Rate limiting nas APIs**
4. **Validação de entrada com Zod**
5. **Testes unitários**
6. **Dark mode**
7. **Export de dados**
8. **Webhook para notificações**

---

## 📚 Links Úteis

- [Next.js API Routes](https://nextjs.org/docs/pages/building-your-application/routing/api-routes)
- [PostgreSQL + TypeScript](https://node-postgres.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [OAuth Mercado Livre](https://developers.mercadolibre.com.br/)

---

**✅ Front-end Completo - Pronto para Usar!**

**Acesse: http://localhost:3000/configuracoes**
