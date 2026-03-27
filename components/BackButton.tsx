"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export default function BackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.push("/dashboard")}
      className="flex items-center gap-2 text-gray-400 transition hover:text-green-500"
    >
      <ArrowLeft size={18} />
      Voltar para Dashboard
    </button>
  );
}
