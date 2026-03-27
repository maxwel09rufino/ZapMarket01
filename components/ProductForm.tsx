import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getProductOfferLabel } from "@/lib/products/client";

export type ProductFormValues = {
  title: string;
  itemId: string;
  linkOriginal: string;
  linkAffiliate: string;
  linkShort: string;
  marketingMessage: string;
  price: string;
  originalPrice: string;
  image: string;
  images: string[];
  description: string;
  seller: string;
  discount: number | null;
  hasCouponOrDiscount: boolean;
  couponLabel: string;
  marketplace: "mercadolivre";
};

export type ProductFormErrors = {
  title?: string;
  linkOriginal?: string;
  price?: string;
};

type ProductFormProps = {
  values: ProductFormValues;
  errors: ProductFormErrors;
  onFieldChange: <K extends keyof ProductFormValues>(
    field: K,
    value: ProductFormValues[K],
  ) => void;
};

function ErrorText({ text }: { text?: string }) {
  if (!text) {
    return null;
  }

  return <p className="mt-1 text-xs text-red-400">{text}</p>;
}

export default function ProductForm({
  values,
  errors,
  onFieldChange,
}: ProductFormProps) {
  const hasDiscountBadge = values.discount !== null && values.discount > 0;
  const couponLabel = values.couponLabel.trim();
  const offerLabel = getProductOfferLabel({
    couponLabel,
    discount: values.discount,
    hasCouponOrDiscount: values.hasCouponOrDiscount,
  });

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-200">Nome do Produto *</label>
        <Input
          value={values.title}
          onChange={(event) => onFieldChange("title", event.target.value)}
          placeholder="Ex: iPhone 15 128GB Preto"
          className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
        />
        <ErrorText text={errors.title} />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-200">ITEM_ID</label>
        <Input
          value={values.itemId}
          onChange={(event) => onFieldChange("itemId", event.target.value)}
          placeholder="Ex: MLB123456789"
          className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-200">
          Link Original do Produto *
        </label>
        <Input
          value={values.linkOriginal}
          onChange={(event) => onFieldChange("linkOriginal", event.target.value)}
          placeholder="https://produto.mercadolivre.com.br/..."
          className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
        />
        <ErrorText text={errors.linkOriginal} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-200">Link afiliado</label>
          <Input
            value={values.linkAffiliate}
            onChange={(event) => onFieldChange("linkAffiliate", event.target.value)}
            placeholder="Gerado automaticamente quando a conta de afiliado estiver configurada"
            className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-200">Link curto</label>
          <Input
            value={values.linkShort}
            onChange={(event) => onFieldChange("linkShort", event.target.value)}
            placeholder="Quando disponivel, o sistema preenche o link curto do Mercado Livre"
            className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-200">Preco *</label>
          <Input
            value={values.price}
            onChange={(event) => onFieldChange("price", event.target.value)}
            placeholder="4899.90"
            className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
          />
          <ErrorText text={errors.price} />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-200">Preco original</label>
          <Input
            value={values.originalPrice}
            onChange={(event) => onFieldChange("originalPrice", event.target.value)}
            placeholder="Preenchido quando houver"
            className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-200">URL da imagem</label>
        <Input
          value={values.image}
          onChange={(event) => onFieldChange("image", event.target.value)}
          placeholder="https://http2.mlstatic.com/...jpg"
          className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-200">Loja / vendedor</label>
        <Input
          value={values.seller}
          onChange={(event) => onFieldChange("seller", event.target.value)}
          placeholder="Nome do vendedor (opcional)"
          className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-200">
          Texto do cupom / promocao
        </label>
        <Input
          value={values.couponLabel}
          onChange={(event) => onFieldChange("couponLabel", event.target.value)}
          placeholder="Ex: Cupom de 10% ou Frete gratis"
          className="h-11 rounded-lg border-white/10 bg-[#1f2937] placeholder:text-zinc-500"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-200">Descricao</label>
        <textarea
          value={values.description}
          onChange={(event) => onFieldChange("description", event.target.value)}
          rows={4}
          placeholder="Detalhes do produto para usar em campanhas..."
          className="w-full rounded-lg border border-white/10 bg-[#1f2937] p-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-primary/60 focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-200">
          Mensagem pronta para WhatsApp
        </label>
        <textarea
          value={values.marketingMessage}
          onChange={(event) => onFieldChange("marketingMessage", event.target.value)}
          rows={4}
          placeholder="Gerada automaticamente para divulgacao"
          className="w-full rounded-lg border border-white/10 bg-[#1f2937] p-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-primary/60 focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-[#1f2937] px-4 py-3 text-sm text-zinc-200 transition hover:border-primary/40">
        <input
          type="checkbox"
          checked={values.hasCouponOrDiscount}
          onChange={(event) => onFieldChange("hasCouponOrDiscount", event.target.checked)}
          className="mt-1 size-4 rounded border-white/20 bg-transparent text-primary focus:ring-primary/40"
        />
        <span className="space-y-1">
          <span className="block font-medium text-zinc-100">Produto com cupom ou promocao</span>
          <span className="block text-xs text-zinc-400">
            Marque esta opcao quando o item tiver cupom ativo, mesmo sem preco original preenchido.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span>Marketplace: Mercado Livre</span>
        {offerLabel ? (
          hasDiscountBadge && !couponLabel ? (
            <Badge className="bg-emerald-500/20 text-emerald-300">{offerLabel}</Badge>
          ) : (
            <Badge variant="secondary" className="border-amber-500/40 text-amber-300">
              {offerLabel}
            </Badge>
          )
        ) : values.hasCouponOrDiscount ? (
          <Badge variant="secondary" className="border-amber-500/40 text-amber-300">
            Cupom ou promocao detectado
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
