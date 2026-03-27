"use client";

import { motion } from "framer-motion";
import {
  BarChart3,
  Bot,
  Gauge,
  Home,
  Import,
  Megaphone,
  MessagesSquare,
  Package,
  RadioTower,
} from "lucide-react";

type SidebarItem = {
  label: string;
  Icon: typeof Home;
  active?: boolean;
};

const sidebarItems: SidebarItem[] = [
  { label: "Dashboard", Icon: Home, active: true },
  { label: "Produtos", Icon: Package },
  { label: "Importar produto", Icon: Import },
  { label: "Campanhas", Icon: Megaphone },
  { label: "Disparos", Icon: MessagesSquare },
  { label: "Relatórios", Icon: BarChart3 },
];

const metricCards = [
  { label: "Faturamento", value: "R$ 124.900", delta: "+22,8%" },
  { label: "Produtos ativos", value: "1.248", delta: "+84" },
  { label: "Mensagens enviadas", value: "38.560", delta: "+41%" },
  { label: "Taxa de conversão", value: "12,3%", delta: "+2,1" },
] as const;

const chartBars = [42, 58, 51, 74, 68, 88, 77] as const;

const recentProducts = [
  { name: "Smartwatch XR Pulse", price: "R$ 249,90", status: "Ativo" },
  { name: "JBL Wave Neon", price: "R$ 189,90", status: "Ativo" },
  { name: "Câmera Lens Wi-Fi", price: "R$ 299,90", status: "Pausado" },
] as const;

export function DashboardPreview() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.18 }}
      transition={{ duration: 0.75, ease: "easeOut" }}
      className="relative flex-1"
    >
      <motion.div
        animate={{ y: [0, -10, 0] }}
        transition={{ duration: 7, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        className="cyber-panel neon-border relative overflow-hidden rounded-[34px] p-4 sm:p-6"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(0,255,156,0.12),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(0,255,156,0.08),_transparent_24%)]" />

        <div className="relative grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="rounded-[28px] border border-white/8 bg-black/40 p-4 backdrop-blur-xl">
            <div className="flex items-center gap-3 border-b border-white/8 pb-4">
              <div className="flex size-12 items-center justify-center rounded-2xl border border-[#7affca]/30 bg-[#07110d] text-[#7affca] shadow-[0_0_24px_rgba(0,255,156,0.2)]">
                <Bot className="size-6" />
              </div>
              <div>
                <p className="font-heading text-base font-bold tracking-[0.12em] text-white">
                  ZAPMARKET
                </p>
                <p className="text-xs uppercase tracking-[0.32em] text-[#53f5af]">Automation</p>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              {sidebarItems.map(({ label, Icon, active }) => (
                <div
                  key={label}
                  className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition ${
                    active
                      ? "border border-[#69ffc0]/25 bg-[#09130f] text-white shadow-[0_0_25px_rgba(0,255,156,0.12)]"
                      : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                  }`}
                >
                  <Icon className={`size-4 ${active ? "text-[#7affca]" : "text-zinc-500"}`} />
                  {label}
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.26em] text-zinc-500">Operação</p>
                  <p className="mt-2 text-lg font-semibold text-white">Black Week AI</p>
                </div>
                <Gauge className="size-5 text-[#7affca]" />
              </div>
              <p className="mt-3 text-sm text-zinc-400">Fluxos conectados ao WhatsApp e anúncios.</p>
            </div>
          </aside>

          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-[28px] border border-white/8 bg-black/35 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-heading text-2xl font-bold text-white sm:text-3xl">Dashboard</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Visão central da sua operação automatizada em tempo real.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="cyber-chip text-xs uppercase tracking-[0.28em] text-zinc-300">
                  Mercado Livre conectado
                </span>
                <span className="cyber-button px-4 py-2 text-xs uppercase tracking-[0.26em]">
                  Nova campanha
                </span>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {metricCards.map((card, index) => (
                <motion.div
                  key={card.label}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.45, delay: 0.08 * index }}
                  className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4"
                >
                  <p className="text-sm text-zinc-400">{card.label}</p>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <p className="font-heading text-2xl font-bold text-white">{card.value}</p>
                    <p className="text-sm font-semibold text-[#63f0ad]">{card.delta}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-[28px] border border-white/8 bg-black/30 p-5">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h3 className="font-heading text-xl font-semibold text-white">Produtos recentes</h3>
                    <p className="text-sm text-zinc-500">Mix pronto para campanhas automáticas.</p>
                  </div>
                  <span className="cyber-chip text-xs uppercase tracking-[0.28em] text-zinc-300">
                    Importação ativa
                  </span>
                </div>

                <div className="space-y-3">
                  {recentProducts.map((product) => (
                    <div
                      key={product.name}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{product.name}</p>
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                          Pronto para disparo
                        </p>
                      </div>
                      <p className="text-sm text-zinc-300">{product.price}</p>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          product.status === "Ativo"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-amber-500/15 text-amber-300"
                        }`}
                      >
                        {product.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[28px] border border-white/8 bg-black/30 p-5">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <h3 className="font-heading text-xl font-semibold text-white">Campanha ativa</h3>
                    <p className="text-sm text-zinc-500">Modo de energia com IA de distribuição.</p>
                  </div>
                  <RadioTower className="size-5 text-[#7affca]" />
                </div>

                <div className="grid grid-cols-7 items-end gap-2 rounded-3xl border border-white/6 bg-white/[0.03] px-4 py-5">
                  {chartBars.map((bar, index) => (
                    <motion.div
                      key={`${bar}-${index}`}
                      className="rounded-full bg-gradient-to-t from-[#0a5f3c] via-[#1bd18c] to-[#b0ffe1]"
                      style={{ height: `${bar}%` }}
                      initial={{ scaleY: 0.2, opacity: 0.3 }}
                      whileInView={{ scaleY: 1, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.45, delay: index * 0.05 }}
                    />
                  ))}
                </div>

                <div className="mt-5 space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">Mensagens automáticas</span>
                    <span className="font-semibold text-[#7affca]">96% de entrega</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/8">
                    <motion.div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#00ff9c,#b6ffe3)]"
                      initial={{ width: "12%" }}
                      whileInView={{ width: "78%" }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, delay: 0.35 }}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-3">
                      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Leads</p>
                      <p className="mt-2 font-heading text-2xl font-bold text-white">1.250</p>
                    </div>
                    <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-3">
                      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Cliques</p>
                      <p className="mt-2 font-heading text-2xl font-bold text-white">312</p>
                    </div>
                    <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-3">
                      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Vendas</p>
                      <p className="mt-2 font-heading text-2xl font-bold text-white">145</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.section>
  );
}
