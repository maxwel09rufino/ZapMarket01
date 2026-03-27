import { formatCurrencyBRL } from "@/lib/products/client";

type CampaignProduct = {
  title: string;
  price: number;
  originalPrice?: number;
  link: string;
  seller?: string | null;
  couponCode?: string | null;
};

export const CAMPAIGN_TEMPLATE_VARIABLES = [
  "{nome}",
  "{preco}",
  "{preco_antigo}",
  "{link}",
  "{loja}",
  "{cupom}",
] as const;

export const CAMPAIGN_TEMPLATE_STARTER = `✅ {nome}

DE: {preco_antigo}
🔥 POR {preco} 🔥 no Pix

🔗{link}
Selecione a loja oficial {loja}

*anuncio`;

function normalizeTemplateValue(value: string | undefined) {
  return (value ?? "").replace(/\r\n/g, "\n");
}

function resolveCouponCode(product: CampaignProduct) {
  return (product.couponCode ?? "").trim();
}

function resolveOriginalPrice(product: CampaignProduct) {
  if (product.originalPrice === undefined || product.originalPrice <= 0) {
    return "";
  }

  return `~${formatCurrencyBRL(product.originalPrice)}~`;
}

function resolveStoreName(product: CampaignProduct) {
  const seller = (product.seller ?? "").trim();
  return seller || "Mercado Livre";
}

export function formatCampaignMessage(template: string, product: CampaignProduct) {
  const normalizedTemplate = normalizeTemplateValue(template);
  const couponCode = resolveCouponCode(product);
  const originalPrice = resolveOriginalPrice(product);
  const storeName = resolveStoreName(product);

  return normalizedTemplate
    .replace(/\{nome\}/gi, product.title)
    .replace(/\{preco\}/gi, formatCurrencyBRL(product.price))
    .replace(/\{preco_antigo\}/gi, originalPrice)
    .replace(/\{link\}/gi, product.link)
    .replace(/\{loja\}/gi, storeName)
    .replace(/\{cupom\}/gi, couponCode)
    .replace(/^DE:\s*$/gim, "")
    .replace(/^\s*$/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
