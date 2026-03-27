"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Bot, Play, Sparkles } from "lucide-react";

const chips = [
  "WhatsApp Automation",
  "Mercado Livre Sync",
  "Campanhas inteligentes",
] as const;

export function HeroSection() {
  return (
    <section className="relative flex min-h-[84vh] items-center justify-center pt-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-10 px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="cyber-chip gap-3 px-5 py-3 text-sm uppercase tracking-[0.32em] text-emerald-200"
        >
          <Sparkles className="size-4 text-[#7affca]" />
          Operação premium para e-commerce automatizado
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.75, delay: 0.15, ease: "easeOut" }}
          className="relative flex h-32 w-32 items-center justify-center rounded-full border border-[#7affca]/35 bg-black/55 shadow-[0_0_0_10px_rgba(0,255,156,0.07),0_0_55px_rgba(0,255,156,0.25)] backdrop-blur-xl"
        >
          <div className="absolute inset-2 rounded-full border border-[#9effd3]/20 bg-[radial-gradient(circle_at_top,_rgba(126,255,202,0.22),_rgba(3,8,7,0.92))]" />
          <div className="absolute inset-4 rounded-full border border-white/10" />
          <Bot className="relative z-10 size-14 text-[#93ffd0]" />
          <motion.span
            className="absolute inset-0 rounded-full border border-[#00ff9c]/30"
            animate={{ scale: [1, 1.14, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 3.5, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" }}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.22, ease: "easeOut" }}
          className="space-y-6"
        >
          <div className="space-y-2">
            <p className="font-heading text-5xl font-black tracking-[0.12em] text-white sm:text-6xl lg:text-8xl">
              ZAPMARKET
            </p>
            <p className="font-heading text-xl font-semibold uppercase tracking-[0.46em] text-[#53f5af] sm:text-2xl">
              Automation
            </p>
          </div>

          <p className="mx-auto max-w-4xl text-lg leading-8 text-zinc-200 sm:text-2xl sm:leading-10">
            A plataforma definitiva para{" "}
            <span className="text-neon font-semibold">automação de e-commerce</span> com
            disparos via WhatsApp e integração Mercado Livre.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.32, ease: "easeOut" }}
          className="flex flex-col items-center gap-4 sm:flex-row"
        >
          <Link href="/dashboard" className="cyber-button group min-w-56 justify-center">
            Começar Agora
            <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
          <Link href="#demo" className="cyber-button-secondary group min-w-56 justify-center">
            <Play className="size-4" />
            Ver Demonstração
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.42 }}
          className="flex flex-wrap items-center justify-center gap-3"
        >
          {chips.map((chip) => (
            <span
              key={chip}
              className="cyber-chip text-xs font-medium uppercase tracking-[0.28em] text-zinc-300"
            >
              {chip}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
