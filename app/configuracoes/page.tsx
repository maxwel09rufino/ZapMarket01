"use client";

import { useState } from "react";
import { CheckSquare, KeyRound, Settings, ShieldCheck } from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import BackButton from "@/components/BackButton";
import MeliCredentialsManager from "@/components/MeliCredentialsManager";
import MeliProductValidator from "@/components/MeliProductValidator";
import { Card } from "@/components/ui/card";

type Tab = "credentials" | "validator";

const tabs = [
  {
    id: "credentials" as const,
    label: "Credenciais",
    description: "Cadastrar client_id, client_secret e refresh_token",
    Icon: KeyRound,
  },
  {
    id: "validator" as const,
    label: "Validador",
    description: "Testar links e revisar historico do parser HTML",
    Icon: CheckSquare,
  },
];

function SettingsPageContent() {
  const [activeTab, setActiveTab] = useState<Tab>("credentials");

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#020409] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_38%_at_88%_0%,rgba(34,197,94,0.24),transparent),radial-gradient(35%_30%_at_4%_0%,rgba(59,130,246,0.16),transparent)]" />

      <main className="relative mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <BackButton />
        </div>

        <section className="relative overflow-hidden rounded-[32px] border border-emerald-500/20 bg-[linear-gradient(135deg,rgba(6,12,22,0.96),rgba(3,8,14,0.92))] p-8 shadow-[0_28px_80px_rgba(2,6,23,0.45)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(48%_90%_at_100%_0%,rgba(34,197,94,0.24),transparent),radial-gradient(26%_40%_at_0%_0%,rgba(59,130,246,0.12),transparent)]" />

          <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200">
                <div className="rounded-xl bg-emerald-500/20 p-2 text-emerald-300">
                  <Settings className="size-5" />
                </div>
                Configuracoes do Mercado Livre
              </div>

              <h1 className="font-heading text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl">
                Credenciais, validacao e parser inteligente do Mercado Livre.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-300 sm:text-lg">
                Centralize as credenciais da sua aplicacao, mantenha os fluxos de afiliado prontos
                e valide links do Mercado Livre sem sair do painel.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[470px]">
              <Card className="rounded-3xl border-white/10 bg-[#0a111d]/90 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-zinc-400">Leitura principal</p>
                    <p className="mt-2 text-2xl font-bold text-zinc-50">HTML</p>
                  </div>
                  <div className="rounded-2xl bg-emerald-500/15 p-3 text-emerald-300">
                    <ShieldCheck className="size-5" />
                  </div>
                </div>
              </Card>

              <Card className="rounded-3xl border-white/10 bg-[#0a111d]/90 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-zinc-400">Credenciais</p>
                    <p className="mt-2 text-2xl font-bold text-zinc-50">OAuth</p>
                  </div>
                  <div className="rounded-2xl bg-blue-500/15 p-3 text-blue-300">
                    <KeyRound className="size-5" />
                  </div>
                </div>
              </Card>

              <Card className="rounded-3xl border-white/10 bg-[#0a111d]/90 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-zinc-400">Testes</p>
                    <p className="mt-2 text-2xl font-bold text-zinc-50">Links</p>
                  </div>
                  <div className="rounded-2xl bg-violet-500/15 p-3 text-violet-300">
                    <CheckSquare className="size-5" />
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="grid gap-3 lg:grid-cols-2">
            {tabs.map(({ id, label, description, Icon }) => {
              const isActive = activeTab === id;

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`rounded-[28px] border p-5 text-left transition-all ${
                    isActive
                      ? "border-emerald-500/35 bg-[linear-gradient(135deg,rgba(18,73,44,0.55),rgba(7,18,28,0.96))] shadow-[0_20px_60px_rgba(34,197,94,0.12)]"
                      : "border-white/10 bg-[#09111b]/80 hover:border-emerald-500/20 hover:bg-[#0b1420]"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`rounded-2xl p-3 ${
                        isActive
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-white/5 text-zinc-300"
                      }`}
                    >
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <p className="font-heading text-xl font-semibold text-zinc-50">{label}</p>
                      <p className="mt-1 text-sm text-zinc-400">{description}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-6">
          <Card className="rounded-[32px] border-white/10 bg-[#070d16]/85 p-6 sm:p-8">
            {activeTab === "credentials" ? <MeliCredentialsManager /> : null}
            {activeTab === "validator" ? <MeliProductValidator /> : null}
          </Card>
        </section>

        <Card className="mt-6 rounded-[28px] border-emerald-500/20 bg-[linear-gradient(135deg,rgba(8,39,24,0.6),rgba(7,12,20,0.94))] p-5">
          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <h2 className="font-heading text-xl font-semibold text-zinc-50">
                Fluxo recomendado
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-300">
                Cadastre primeiro as credenciais ativas da sua conta. Depois use o validador para
                testar links e revisar o historico salvo no PostgreSQL antes de liberar a
                importacao principal na area de produtos.
              </p>
            </div>
            <div className="grid gap-3 text-sm text-zinc-200 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                1. Salvar credencial OAuth
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                2. Confirmar token ativo
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                3. Validar links pelo HTML
              </div>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AuthGuard>
      <SettingsPageContent />
    </AuthGuard>
  );
}
