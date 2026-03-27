import { NextRequest, NextResponse } from "next/server";
import { handleAssistantRequest } from "@/lib/assistant/engine";
import { sendWhatsappMessage } from "@/lib/whatsapp/serviceProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stripBotPrefix(message: string) {
  // Remove prefixos comuns de bot: ; / ! .
  return message.replace(/^[;\/!\.\-\s]+/, "").trim();
}

// Espera receber { groupId, senderId, senderName, message }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log("[INCOMING BOT-WHATSAPP] Payload recebido:", body);
    const { groupId, senderId, senderName } = body;
    let { message } = body;
    if (!groupId || !message) {
      console.error("[INCOMING BOT-WHATSAPP] Dados obrigatórios ausentes.", body);
      return NextResponse.json({ error: "Dados obrigatórios ausentes." }, { status: 400 });
    }

    // Remove prefixos de bot
    message = stripBotPrefix(message);

    // Usuário fake para contexto mínimo
    const user = {
      id: senderId || groupId,
      name: senderName || "Grupo WhatsApp",
      email: `${senderId || groupId}@zapmarket.local`,
      role: "user",
    };

    // Processa mensagem no motor do assistente
    const response = await handleAssistantRequest({ user, message });
    const reply = typeof response.message === "string" ? response.message : "(Sem resposta)";

    // Envia resposta de volta ao grupo
    const sendResult = await sendWhatsappMessage({
      number: groupId,
      message: reply,
    });
    console.log("[INCOMING BOT-WHATSAPP] Resposta enviada:", sendResult);

    return NextResponse.json({ ok: true, reply });
  } catch (error) {
    console.error("[INCOMING BOT-WHATSAPP] Erro:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
