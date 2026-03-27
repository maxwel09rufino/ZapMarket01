import {
  MeliPublicationError,
  MeliPublicationValidationError,
} from "@/lib/meli/publications";
import { MeliCredentialValidationError } from "@/lib/meli/store";
import { ProductNotFoundError } from "@/lib/products/store";

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

export function resolvePublicationError(error: unknown) {
  if (error instanceof ProductNotFoundError) {
    return {
      status: 404,
      message: error.message,
    };
  }

  if (error instanceof MeliCredentialValidationError) {
    return {
      status: 400,
      message: error.message,
    };
  }

  if (error instanceof MeliPublicationValidationError) {
    return {
      status: 400,
      message: error.message,
      causes: error.causes,
    };
  }

  if (error instanceof MeliPublicationError) {
    return {
      status: 400,
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
  }

  return {
    status: 500,
    message: "Nao foi possivel concluir a operacao de publicacao no Mercado Livre.",
  };
}
