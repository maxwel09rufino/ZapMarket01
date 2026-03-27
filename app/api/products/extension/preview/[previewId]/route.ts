import { NextResponse } from "next/server";
import {
  getProductImportPreviewById,
  serializeProductImportPreview,
} from "@/lib/products/extensionPreview";
import { getProductById } from "@/lib/products/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function GET(
  _request: Request,
  context: RouteContext<"/api/products/extension/preview/[previewId]">,
) {
  const { previewId } = await context.params;
  const preview = await getProductImportPreviewById(previewId);

  if (!preview) {
    return NextResponse.json(
      { error: "Preview de importacao nao encontrado." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  const importedProduct = preview.importedProductId
    ? await getProductById(preview.importedProductId)
    : null;

  return NextResponse.json(
    {
      preview: serializeProductImportPreview(preview),
      importedProduct: importedProduct
        ? {
            id: importedProduct.id,
            title: importedProduct.title,
            link: importedProduct.link,
          }
        : undefined,
    },
    {
      status: 200,
      headers: NO_STORE_HEADERS,
    },
  );
}
