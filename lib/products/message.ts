import type { Product } from "@/lib/products/types";

function formatCurrency(value: number | undefined) {
  if (value === undefined) {
    return "R$ 0,00";
  }

  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  });
}

export function buildProductMarketingMessage(
  product: Pick<Product, "title" | "price" | "link">,
) {
  return `${product.title}

🔥 POR ${formatCurrency(product.price)}

🔗 ${product.link}`;
}

export function buildCampaignMessage(
  product: Pick<Product, "title" | "price" | "link">,
) {
  return buildProductMarketingMessage(product);
}
