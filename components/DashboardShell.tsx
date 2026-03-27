"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Menu,
  MessageSquareText,
  Package,
  UsersRound,
} from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { MetricCard } from "@/components/Card";
import { CampaignEmpty } from "@/components/CampaignEmpty";
import { StatusCard } from "@/components/StatusCard";
import { Button } from "@/components/ui/button";
import { AUTO_REFRESH_INTERVAL_MS } from "@/lib/autoRefresh";
import type { DashboardOverview } from "@/lib/dashboard";

type DashboardShellProps = {
  initialOverview: DashboardOverview;
};

const metricVisuals = {
  messagesSent: {
    title: "Mensagens Enviadas",
    icon: MessageSquareText,
    iconColorClassName: "text-blue-400",
    iconBgClassName: "bg-blue-500/15",
  },
  activeCampaigns: {
    title: "Campanhas Ativas",
    icon: Activity,
    iconColorClassName: "text-emerald-400",
    iconBgClassName: "bg-emerald-500/15",
  },
  totalContacts: {
    title: "Total de Contatos",
    icon: UsersRound,
    iconColorClassName: "text-violet-400",
    iconBgClassName: "bg-violet-500/15",
  },
  registeredProducts: {
    title: "Produtos Cadastrados",
    icon: Package,
    iconColorClassName: "text-amber-300",
    iconBgClassName: "bg-amber-500/15",
  },
} as const;

const SIDEBAR_STORAGE_KEY = "zapmarket.sidebar.collapsed";
export function DashboardShell({ initialOverview }: DashboardShellProps) {
  const router = useRouter();
  const [overview, setOverview] = useState(initialOverview);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
    router.prefetch("/whatsapp");
    router.prefetch("/produtos");
    router.prefetch("/campanhas");
    router.prefetch("/contatos");
  }, [router]);

  useEffect(() => {
    const persistedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (persistedValue === "true") {
      setIsSidebarCollapsed(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    let isMounted = true;

    const loadOverview = async (showLoader: boolean) => {
      if (showLoader && isMounted) {
        setIsRefreshing(true);
      }
      try {
        const response = await fetch("/api/dashboard/overview", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar os dados do dashboard.");
        }

        const freshOverview = (await response.json()) as DashboardOverview;
        if (isMounted) {
          setOverview(freshOverview);
        }
      } catch {
        // Mantem os dados iniciais em caso de falha de rede.
      } finally {
        if (showLoader && isMounted) {
          setIsRefreshing(false);
        }
      }
    };

    void loadOverview(true);

    const intervalId = window.setInterval(() => {
      void loadOverview(false);
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const metrics = [
    {
      ...metricVisuals.messagesSent,
      value: overview.metrics.messagesSent,
    },
    {
      ...metricVisuals.activeCampaigns,
      value: overview.metrics.activeCampaigns,
    },
    {
      ...metricVisuals.totalContacts,
      value: overview.metrics.totalContacts,
    },
    {
      ...metricVisuals.registeredProducts,
      value: overview.metrics.registeredProducts,
    },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_45%_at_92%_4%,rgba(34,197,94,0.14),transparent),radial-gradient(30%_30%_at_0%_0%,rgba(59,130,246,0.12),transparent)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px]">
        <Sidebar
          collapsed={isSidebarCollapsed}
          mobileOpen={isMobileSidebarOpen}
          onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
        />

        <main className="w-full flex-1 px-4 pb-8 pt-8 sm:px-6 lg:px-9">
          <div className="mb-4 flex items-center justify-between lg:hidden">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => setIsMobileSidebarOpen(true)}
              aria-label="Abrir menu lateral"
            >
              <Menu className="size-5" />
            </Button>
          </div>

          <Header />

          <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <MetricCard
                key={metric.title}
                title={metric.title}
                value={metric.value}
                icon={metric.icon}
                iconColorClassName={metric.iconColorClassName}
                iconBgClassName={metric.iconBgClassName}
                isLoading={isRefreshing}
              />
            ))}
          </section>

          <section className="mt-8 grid gap-7 xl:grid-cols-[minmax(0,1fr)_350px]">
            <div>
              <div className="mb-4 flex items-end justify-between gap-3">
                <h2 className="font-heading text-[2rem] font-bold text-zinc-100">
                  Campanhas Recentes
                </h2>
                <button
                  type="button"
                  className="hidden text-lg font-semibold text-primary transition-colors hover:text-primary/80 sm:block"
                >
                  Ver todas
                </button>
              </div>

              {overview.recentCampaigns.length === 0 ? (
                <CampaignEmpty />
              ) : (
                <div className="space-y-3 rounded-3xl border border-white/10 bg-[#080d16]/75 p-4">
                  {overview.recentCampaigns.map((campaign) => (
                    <div
                      key={campaign.id}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <p className="text-base font-semibold text-zinc-100">{campaign.name}</p>
                      <p className="mt-1 text-sm text-zinc-400">
                        {campaign.sentMessages} mensagens enviadas
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h2 className="mb-4 font-heading text-[2rem] font-bold text-zinc-100">
                Status do Sistema
              </h2>
              <StatusCard status={overview.systemStatus.whatsappApi} />
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
