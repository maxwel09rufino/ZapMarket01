import type { ProductRecord } from "@/lib/products/client";

export type MeliPublicationFieldScope = "attribute" | "sale_term";

export type MeliPublicationFieldValueType =
  | "string"
  | "number"
  | "number_unit"
  | "boolean"
  | "list"
  | "grid_id"
  | "unknown";

export type MeliPublicationOption = {
  id: string;
  name: string;
};

export type MeliPublicationUnit = {
  id: string;
  name: string;
};

export type MeliPublicationField = {
  scope: MeliPublicationFieldScope;
  id: string;
  name: string;
  valueType: MeliPublicationFieldValueType;
  required: boolean;
  multivalued: boolean;
  groupName?: string;
  hint?: string;
  defaultUnit?: string;
  maxLength?: number;
  options: MeliPublicationOption[];
  allowedUnits: MeliPublicationUnit[];
  defaultValueId?: string;
  defaultValueName?: string;
};

export type MeliPublicationDraftEntry = {
  id: string;
  scope: MeliPublicationFieldScope;
  valueType: MeliPublicationFieldValueType;
  valueId?: string;
  valueName?: string;
  values?: string[];
  unit?: string;
};

export type MeliPublicationDraft = {
  productId: string;
  title: string;
  categoryId: string;
  listingTypeId: string;
  price: number;
  currencyId: string;
  availableQuantity: number;
  buyingMode: "buy_it_now";
  condition: "new" | "used" | "not_specified";
  description: string;
  pictures: string[];
  channels: string[];
  attributes: MeliPublicationDraftEntry[];
  saleTerms: MeliPublicationDraftEntry[];
};

export type MeliPublicationCategoryOption = {
  id: string;
  name: string;
  domainId?: string;
  domainName?: string;
};

export type MeliPublicationListingTypeOption = {
  id: string;
  name: string;
  mapping?: string;
  remainingListings?: number | null;
};

export type MeliPublishedItemSummary = {
  id: string;
  permalink?: string;
  status?: string;
  categoryId?: string;
  categoryName?: string;
  listingTypeId?: string;
  catalogProductId?: string;
  lastUpdated?: string;
};

export type MeliPublicationPrepareResponse = {
  credential: {
    id: string;
    name?: string;
    meliNickname?: string;
    siteId: string;
  };
  product: ProductRecord;
  categories: MeliPublicationCategoryOption[];
  listingTypes: MeliPublicationListingTypeOption[];
  attributeFields: MeliPublicationField[];
  saleTermFields: MeliPublicationField[];
  draft: MeliPublicationDraft;
  publishedItem?: MeliPublishedItemSummary;
  warnings: string[];
};

export type MeliPublicationValidationCause = {
  code?: string;
  type?: string;
  department?: string;
  message: string;
  references?: string[];
};

export type MeliPublicationValidationResponse = {
  valid: boolean;
  message: string;
  causes: MeliPublicationValidationCause[];
};

export type MeliPublicationPublishResponse = {
  message: string;
  item: MeliPublishedItemSummary;
  product: ProductRecord;
  warning?: string;
};
