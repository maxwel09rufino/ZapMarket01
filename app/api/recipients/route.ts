import { NextRequest, NextResponse } from "next/server";
import {
  createRecipientRecord,
  createRecipientsBulk,
  deleteRecipientById,
  listRecipients,
  RecipientNotFoundError,
  RecipientValidationError,
} from "@/lib/recipients/store";
import { toRecipientDTO, type RecipientDraft } from "@/lib/recipients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

type RecipientBody = {
  id?: string;
  type?: "contact" | "group" | "channel";
  name?: string;
  phone?: string;
  link?: string;
  tag?: string;
  recipients?: RecipientDraft[];
};

function parseRecipientDraft(body: RecipientBody): RecipientDraft {
  return {
    type: (body.type ?? "contact") as RecipientDraft["type"],
    name: body.name ?? "",
    phone: body.phone ?? "",
    link: body.link ?? "",
    tag: body.tag ?? "",
  };
}

function resolveError(error: unknown) {
  if (error instanceof RecipientValidationError) {
    return {
      status: 400,
      message: error.message,
    };
  }

  if (error instanceof RecipientNotFoundError) {
    return {
      status: 404,
      message: error.message,
    };
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);

    if (code === "28P01") {
      return {
        status: 500,
        message: "Falha ao autenticar no PostgreSQL. Verifique o DATABASE_URL.",
      };
    }

    if (code === "3D000") {
      return {
        status: 500,
        message: "Banco de dados nao encontrado. Verifique se o banco 'zapmarket' existe.",
      };
    }

    if (code === "42P01") {
      return {
        status: 500,
        message: "Tabela 'recipients' nao encontrada. Crie a tabela antes de usar a API.",
      };
    }
  }

  return {
    status: 500,
    message: "Nao foi possivel processar a solicitacao.",
  };
}

export async function GET() {
  try {
    const recipients = (await listRecipients()).map(toRecipientDTO);
    return NextResponse.json(recipients, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const resolved = resolveError(error);
    return NextResponse.json(
      { error: resolved.message },
      { status: resolved.status, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RecipientBody | null;
  if (!body) {
    return NextResponse.json(
      { error: "Payload invalido." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    if (Array.isArray(body.recipients)) {
      const created = await createRecipientsBulk(body.recipients);
      return NextResponse.json(
        {
          imported: created.length,
          recipients: created.map(toRecipientDTO),
        },
        {
          status: 201,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    const created = await createRecipientRecord(parseRecipientDraft(body));
    return NextResponse.json(toRecipientDTO(created), {
      status: 201,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const resolved = resolveError(error);
    return NextResponse.json(
      { error: resolved.message },
      { status: resolved.status, headers: NO_STORE_HEADERS },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RecipientBody | null;
  const id = (body?.id ?? "").trim();

  if (!id) {
    return NextResponse.json(
      { error: "ID do destinatario e obrigatorio." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    await deleteRecipientById(id);
    return NextResponse.json(
      { success: true },
      {
        status: 200,
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    const resolved = resolveError(error);
    return NextResponse.json(
      { error: resolved.message },
      { status: resolved.status, headers: NO_STORE_HEADERS },
    );
  }
}
