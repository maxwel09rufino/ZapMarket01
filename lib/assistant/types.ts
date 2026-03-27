export type AssistantAction = {
  id: string;
  label: string;
  kind: "submit" | "navigate";
  value?: string;
  href?: string;
};

export type AssistantCardField = {
  label: string;
  value: string;
};

export type AssistantCard = {
  id: string;
  title: string;
  description?: string;
  tone?: "neutral" | "success" | "warning";
  imageUrl?: string;
  fields?: AssistantCardField[];
};

export type AssistantSummary = {
  productsCount: number;
  contactsCount: number;
  activeCampaignsCount: number;
  finishedCampaignsCount: number;
  failedCampaignsCount: number;
};

export type ProductImportWorkflow = {
  type: "product-import";
  stage: "confirm";
  sourceUrl: string;
};

export type ContactCreateWorkflow =
  | {
      type: "contact-create";
      stage: "await-name";
    }
  | {
      type: "contact-create";
      stage: "await-phone";
      draft: {
        name: string;
      };
    };

export type CampaignCreateWorkflow =
  | {
      type: "campaign-create";
      stage: "select-product";
    }
  | {
      type: "campaign-create";
      stage: "select-recipient-scope";
      productId: string;
      productTitle: string;
    }
  | {
      type: "campaign-create";
      stage: "select-delay";
      productId: string;
      productTitle: string;
      recipientIds: string[];
      recipientLabel: string;
      messageTemplate: string;
      campaignName: string;
    }
  | {
      type: "campaign-create";
      stage: "confirm";
      draft: {
        productId: string;
        productTitle: string;
        recipientIds: string[];
        recipientLabel: string;
        messageTemplate: string;
        campaignName: string;
        delaySeconds: number;
      };
    };

export type AssistantWorkflow =
  | ProductImportWorkflow
  | ContactCreateWorkflow
  | CampaignCreateWorkflow;

export type AssistantRequestPayload = {
  message?: string;
  actionId?: string;
  workflow?: AssistantWorkflow | null;
};

export type AssistantResponsePayload = {
  message: string;
  summary?: AssistantSummary;
  cards?: AssistantCard[];
  actions?: AssistantAction[];
  workflow?: AssistantWorkflow | null;
};
