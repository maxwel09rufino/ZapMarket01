import {
  CAMPAIGN_DELAY_RANDOMIZATION_MS,
  type CampaignRecord,
} from "@/lib/campaigns/types";
import {
  CampaignValidationError,
  claimNextPendingDelivery,
  getCampaignById,
  listCampaignChannelTargets,
  markCampaignFailed,
  markCampaignFinished,
  markCampaignReadyToStart,
  markDeliveryFailed,
  markDeliverySent,
  markDeliverySubmitted,
  recoverActiveCampaignIds,
} from "@/lib/campaigns/store";
import {
  getChannelSendAccess,
  getWhatsappConnectionStatus,
  sendCampaignWhatsappMessage,
} from "@/lib/campaigns/whatsapp";

type CampaignQueueState = {
  bootstrapped: boolean;
  bootstrapPromise?: Promise<void>;
  runningCampaigns: Set<string>;
};

const globalForCampaignQueue = globalThis as typeof globalThis & {
  campaignQueueState?: CampaignQueueState;
};

const campaignQueueState =
  globalForCampaignQueue.campaignQueueState ??
  (globalForCampaignQueue.campaignQueueState = {
    bootstrapped: false,
    bootstrapPromise: undefined,
    runningCampaigns: new Set<string>(),
  });

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveDelayMs(baseDelaySeconds: number) {
  return baseDelaySeconds * 1000 + Math.floor(Math.random() * CAMPAIGN_DELAY_RANDOMIZATION_MS);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isFatalCampaignError(message: string) {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("nao conectado") ||
    normalizedMessage.includes("indisponivel") ||
    normalizedMessage.includes("connection closed")
  );
}

function shouldPauseCampaignRun(message: string) {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("nao conectado") ||
    normalizedMessage.includes("indisponivel") ||
    normalizedMessage.includes("connection closed") ||
    normalizedMessage.includes("fetch failed") ||
    normalizedMessage.includes("econnrefused") ||
    normalizedMessage.includes("network")
  );
}

function scheduleCampaignRun(campaignId: string) {
  if (campaignQueueState.runningCampaigns.has(campaignId)) {
    return;
  }

  campaignQueueState.runningCampaigns.add(campaignId);
  setTimeout(() => {
    void runCampaign(campaignId);
  }, 0);
}

export function ensureCampaignRuns(campaignIds: string[]) {
  campaignIds.forEach((campaignId) => {
    if (campaignId.trim()) {
      scheduleCampaignRun(campaignId);
    }
  });
}

async function assertCampaignChannelAccess(campaignId: string) {
  const channels = await listCampaignChannelTargets(campaignId);

  for (const channel of channels) {
    const access = await getChannelSendAccess(channel.target);
    if (access.canSend) {
      continue;
    }

    const channelLabel = access.name ?? channel.name ?? "canal selecionado";
    const roleLabel = access.role ? ` Papel atual: ${access.role}.` : "";
    throw new CampaignValidationError(
      `A conta conectada nao e administradora do canal "${channelLabel}".${roleLabel} Entre como ADMIN ou OWNER antes de iniciar a campanha.`,
    );
  }
}

async function runCampaign(campaignId: string) {
  try {
    while (true) {
      const campaign = await getCampaignById(campaignId);
      if (!campaign || campaign.status !== "sending") {
        return;
      }

      try {
        const whatsappStatus = await getWhatsappConnectionStatus();
        if (!whatsappStatus.connected) {
          return;
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        if (shouldPauseCampaignRun(errorMessage)) {
          return;
        }

        throw error;
      }

      const delivery = await claimNextPendingDelivery(campaignId);
      if (!delivery) {
        await markCampaignFinished(campaignId);
        return;
      }

      try {
        const result = await sendCampaignWhatsappMessage({
          recipientType: delivery.recipientType,
          target: delivery.recipientTarget,
          message: delivery.message,
          imageUrl: delivery.productImage,
        });

        if (result.deliveryStatus === "submitted") {
          await markDeliverySubmitted(delivery.id, result);
        } else {
          await markDeliverySent(delivery.id, result);
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        await markDeliveryFailed(delivery.id, errorMessage);

        if (isFatalCampaignError(errorMessage)) {
          await markCampaignFailed(campaignId, errorMessage);
          return;
        }
      }

      const updatedCampaign = await getCampaignById(campaignId);
      if (!updatedCampaign) {
        return;
      }

      if (updatedCampaign.status !== "sending") {
        return;
      }

      if (updatedCampaign.remainingCount <= 0) {
        await markCampaignFinished(campaignId);
        return;
      }

      await wait(resolveDelayMs(updatedCampaign.delaySeconds));
    }
  } catch (error) {
    await markCampaignFailed(campaignId, getErrorMessage(error)).catch(() => null);
  } finally {
    campaignQueueState.runningCampaigns.delete(campaignId);
  }
}

export async function ensureCampaignQueueReady() {
  if (campaignQueueState.bootstrapped) {
    return;
  }

  if (!campaignQueueState.bootstrapPromise) {
    campaignQueueState.bootstrapPromise = (async () => {
      const activeCampaignIds = await recoverActiveCampaignIds();
      activeCampaignIds.forEach(scheduleCampaignRun);
      campaignQueueState.bootstrapped = true;
      campaignQueueState.bootstrapPromise = undefined;
    })();
  }

  await campaignQueueState.bootstrapPromise;
}

export async function startCampaignExecution(campaignId: string): Promise<CampaignRecord> {
  await ensureCampaignQueueReady();

  const whatsappStatus = await getWhatsappConnectionStatus();
  if (!whatsappStatus.connected) {
    throw new Error("WhatsApp nao conectado. Conecte a sessao antes de iniciar a campanha.");
  }

  await assertCampaignChannelAccess(campaignId);

  const campaign = await markCampaignReadyToStart(campaignId);
  scheduleCampaignRun(campaign.id);
  return campaign;
}
