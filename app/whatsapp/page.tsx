"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Link2, QrCode } from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { ConnectionCard } from "@/components/ConnectionCard";
import { PairingSection } from "@/components/PairingSection";
import { QRCodeSection } from "@/components/QRCodeSection";

type ConnectionMode = "qr" | "pairing";

function WhatsAppConnectionPageContent() {
  const router = useRouter();
  const [activeMode, setActiveMode] = useState<ConnectionMode>("qr");

  useEffect(() => {
    router.prefetch("/dashboard");
  }, [router]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05080f]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_40%_at_90%_0%,rgba(34,197,94,0.16),transparent),radial-gradient(25%_25%_at_0%_10%,rgba(59,130,246,0.14),transparent)]" />

      <main className="relative mx-auto w-full max-w-[900px] px-4 py-10 sm:px-6 md:py-12">
        <div className="mb-5">
          <Link
            href="/dashboard"
            prefetch
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-all hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
          >
            <ArrowLeft className="size-4" />
            Voltar ao Dashboard
          </Link>
        </div>

        <header className="mb-8 space-y-2">
          <h1 className="font-heading text-4xl font-bold tracking-tight text-zinc-50">
            Conexao WhatsApp
          </h1>
          <p className="text-lg text-zinc-300">
            Escolha como quer integrar seu WhatsApp a plataforma.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <ConnectionCard
            title="QR Code"
            badgeText="Mais facil"
            description="Escaneie o QR Code com o WhatsApp. Sem precisar de numero ou API externa."
            icon={QrCode}
            isActive={activeMode === "qr"}
            onClick={() => setActiveMode("qr")}
          />
          <ConnectionCard
            title="Codigo de Pareamento"
            description="Digite seu numero e receba um codigo no WhatsApp para conectar."
            icon={Link2}
            isActive={activeMode === "pairing"}
            onClick={() => setActiveMode("pairing")}
          />
        </section>

        <section className="mt-6">
          <div className="transition-all duration-300">
            {activeMode === "qr" ? <QRCodeSection /> : <PairingSection />}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function WhatsAppConnectionPage() {
  return (
    <AuthGuard>
      <WhatsAppConnectionPageContent />
    </AuthGuard>
  );
}
