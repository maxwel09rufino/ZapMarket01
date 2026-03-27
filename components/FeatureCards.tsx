"use client";

import { motion } from "framer-motion";
import { BarChart3, Link2, MessageCircleMore, PackageSearch } from "lucide-react";

const features = [
  {
    title: "Importador Inteligente",
    description: "Produtos do Mercado Livre",
    Icon: PackageSearch,
  },
  {
    title: "Integração Completa",
    description: "Sincronização automática",
    Icon: Link2,
  },
  {
    title: "Disparos WhatsApp",
    description: "Campanhas automatizadas",
    Icon: MessageCircleMore,
  },
  {
    title: "Dashboard Avançado",
    description: "Métricas e performance",
    Icon: BarChart3,
  },
] as const;

export function FeatureCards() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-6xl px-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {features.map(({ title, description, Icon }, index) => (
          <motion.article
            key={title}
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.55, delay: index * 0.08 }}
            whileHover={{ y: -6, scale: 1.01 }}
            className="group relative overflow-hidden rounded-[24px] border border-[#4af2ac]/15 bg-[linear-gradient(180deg,rgba(6,12,11,0.92),rgba(4,9,8,0.88))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.32)]"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(0,255,156,0.12),_transparent_50%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <motion.div
              className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#7affca] to-transparent"
              animate={{ opacity: [0.25, 0.95, 0.28], scaleX: [0.85, 1, 0.88] }}
              transition={{ duration: 2.8, repeat: Number.POSITIVE_INFINITY, delay: index * 0.2 }}
            />

            <div className="relative flex items-start gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-[#7affca]/25 bg-[#07110d] text-[#7affca] shadow-[0_0_24px_rgba(0,255,156,0.18)]">
                <Icon className="size-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-heading text-lg font-semibold text-white">{title}</h3>
                <p className="text-sm text-zinc-400">{description}</p>
              </div>
            </div>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
