type ProductImportEvent = {
  type: string;
  at: string;
  [key: string]: unknown;
};

type ProductImportListener = (event: ProductImportEvent) => void;

const globalForProductImport = globalThis as typeof globalThis & {
  productImportListeners?: Set<ProductImportListener>;
};

const productImportListeners =
  globalForProductImport.productImportListeners ??
  (globalForProductImport.productImportListeners = new Set<ProductImportListener>());

export function emitProductImportEvent(event: ProductImportEvent) {
  for (const listener of productImportListeners) {
    try {
      listener(event);
    } catch {
      // Ignora listeners quebrados para nao derrubar o stream global.
    }
  }
}

export function createProductImportEventStream(signal?: AbortSignal) {
  let dispose = () => undefined;

  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (payload: ProductImportEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const listener: ProductImportListener = (event) => {
        send(event);
      };

      productImportListeners.add(listener);
      send({
        type: "ready",
        at: new Date().toISOString(),
      });

      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15_000);

      dispose = () => {
        clearInterval(keepAlive);
        productImportListeners.delete(listener);
      };

      signal?.addEventListener("abort", dispose, { once: true });
    },
    cancel() {
      dispose();
    },
  });
}
