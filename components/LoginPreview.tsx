"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Bot, Lock, Mail, ShieldCheck } from "lucide-react";

export function LoginPreview() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      className="w-full max-w-xl"
    >
      <motion.div
        animate={{ y: [0, -12, 0] }}
        transition={{ duration: 6.5, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        className="cyber-panel neon-border relative overflow-hidden rounded-[34px] p-8"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(0,255,156,0.16),_transparent_35%)]" />
        <div className="relative">
          <div className="mb-8 flex items-center gap-4">
            <div className="flex size-16 items-center justify-center rounded-3xl border border-[#7affca]/25 bg-[#07110d] text-[#7affca] shadow-[0_0_28px_rgba(0,255,156,0.2)]">
              <Bot className="size-8" />
            </div>
            <div>
              <p className="font-heading text-3xl font-black tracking-[0.12em] text-white">
                ZAPMARKET
              </p>
              <p className="text-sm uppercase tracking-[0.34em] text-[#53f5af]">Automation</p>
            </div>
          </div>

          <div className="space-y-5">
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-300">Usuário</span>
              <div className="cyber-input">
                <Mail className="size-4 text-[#7affca]" />
                <span className="text-sm text-zinc-500">seu@email.com ou usuário</span>
              </div>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-300">Senha</span>
              <div className="cyber-input">
                <Lock className="size-4 text-[#7affca]" />
                <span className="text-sm tracking-[0.45em] text-zinc-500">••••••••••••</span>
              </div>
            </label>

            <button type="button" className="cyber-button w-full justify-center">
              Entrar
            </button>

            <div className="flex items-center justify-between text-sm">
              <Link href="/login" className="text-zinc-400 transition hover:text-[#7affca]">
                Esqueceu a senha
              </Link>
              <Link
                href="/login?mode=register"
                className="text-zinc-400 transition hover:text-[#7affca]"
              >
                Criar conta
              </Link>
            </div>
          </div>

          <div className="mt-8 flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
            <ShieldCheck className="size-4 text-[#7affca]" />
            Sessão protegida com autenticação e rotas seguras.
          </div>
        </div>
      </motion.div>
    </motion.section>
  );
}
