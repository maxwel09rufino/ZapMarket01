export type ProductImportJobStatus = "running" | "completed" | "failed";

export type ProductImportJobPhase = "scanning" | "importing" | "completed" | "failed";

export type ProductImportJobSourceType = "list" | "file" | "api";

export type ProductImportJobSnapshot = {
  id: string;
  sourceType: ProductImportJobSourceType;
  sourceUrl: string;
  normalizedSourceUrl: string;
  sourceLabel?: string;
  status: ProductImportJobStatus;
  phase: ProductImportJobPhase;
  message: string;
  startedAt: string;
  finishedAt?: string;
  maxProducts?: number;
  scannedPages: number;
  totalPages?: number;
  totalResults?: number;
  discoveredProducts: number;
  queuedProducts: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  processedCount: number;
  existingProductsAtStart: number;
  currentPageUrl?: string;
  currentProductUrl?: string;
  currentProductTitle?: string;
  recentErrors: string[];
};
