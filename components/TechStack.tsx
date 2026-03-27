"use client";

import { motion } from "framer-motion";
import { Orbit, Rocket, ScanSearch, Triangle, Waves, Workflow } from "lucide-react";

const stack = [
  {
    name: "Next.js",
    subtitle: "App Router",
    Icon: Workflow,
    accent: "from-white/90 to-zinc-400",
  },
  {
    name: "React",
    subtitle: "TypeScript",
    Icon: Orbit,
    accent: "from-sky-300 to-cyan-400",
  },
  {
    name: "TailwindCSS",
    subtitle: "UI Framework",
    Icon: Waves,
    accent: "from-cyan-300 to-teal-400",
  },
  {
    name: "Framer Motion",
    subtitle: "Animações",
    Icon: Rocket,
    accent: "from-indigo-300 to-sky-400",
  },
  {
    name: "Lucide Icons",
    subtitle: "Interface",
    Icon: ScanSearch,
    accent: "from-emerald-300 to-[#7affca]",
  },
  {
    name: "Vercel",
    subtitle: "Deploy",
    Icon: Triangle,
    accent: "from-zinc-100 to-zinc-500",
  },
] as const;

export function TechStack() {
  return (
    <section id="tech" className="relative mx-auto w-full max-w-6xl px-6 pb-20">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.7 }}
        className="cyber-panel neon-border rounded-[36px] px-6 py-8"
      >
        <div className="mb-8 text-center">
          <p className="text-sm uppercase tracking-[0.4em] text-[#78ffc9]">Tecnologias Utilizadas</p>
          <h2 className="mt-3 font-heading text-3xl font-bold text-white sm:text-4xl">
            Stack SaaS pronta para produção
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {stack.map(({ name, subtitle, Icon, accent }, index) => (
            <motion.article
              key={name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: index * 0.06 }}
              whileHover={{ y: -4 }}
              className="rounded-[24px] border border-white/8 bg-black/30 p-5 text-center"
            >
              <div
                className={`mx-auto flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br ${accent} text-[#06110b] shadow-[0_0_28px_rgba(0,255,156,0.12)]`}
              >
                <Icon className="size-6" />
              </div>
              <h3 className="mt-4 font-heading text-lg font-semibold text-white">{name}</h3>
              <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
            </motion.article>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
