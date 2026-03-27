export type CampaignStatus = "pending" | "sending" | "finished" | "failed";

export type CampaignDeliveryStatus =
  | "pending"
  | "sending"
  | "submitted"
  | "sent"
  | "failed";

export type CampaignRecord = {
  id: string;
  name: string;
  productId?: string;
  productTitle: string;
  selectAllProducts: boolean;
  productCount: number;
  messageTemplate: string;
  previewMessage: string;
  delaySeconds: number;
  batchLimit: number;
  totalContacts: number;
  totalMessages: number;
  sentCount: number;
  submittedCount: number;
  failedCount: number;
  remainingCount: number;
  status: CampaignStatus;
  lastError?: string;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
};

export type CampaignRecordDTO = Omit<
  CampaignRecord,
  "createdAt" | "startedAt" | "finishedAt"
> & {
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type CreateCampaignInput = {
  name: string;
  productId: string;
  selectAllProducts?: boolean;
  recipientIds: string[];
  messageTemplate: string;
  delaySeconds: number;
};

export type CampaignDeliveryRecord = {
  id: string;
  campaignId: string;
  recipientId: string;
  recipientName: string;
  recipientType: "contact" | "group" | "channel";
  recipientTarget: string;
  recipientPhone?: string;
  productImage?: string;
  message: string;
  status: CampaignDeliveryStatus;
  orderIndex: number;
  attempts: number;
  lastError?: string;
  messageId?: string;
  jid?: string;
  createdAt: Date;
  updatedAt: Date;
  sentAt?: Date;
};

export const CAMPAIGN_PRESET_DELAYS = [60, 120, 180] as const;
export const MAX_RECIPIENTS_PER_CAMPAIGN = 50;
export const CAMPAIGN_DELAY_RANDOMIZATION_MS = 2000;

export function toCampaignRecordDTO(campaign: CampaignRecord): CampaignRecordDTO {
  return {
    ...campaign,
    createdAt: campaign.createdAt.toISOString(),
    startedAt: campaign.startedAt?.toISOString(),
    finishedAt: campaign.finishedAt?.toISOString(),
  };
}
