"use client";

import { motion } from "framer-motion";

type EnergyLine = {
  width: string;
  top: string;
  left?: string;
  right?: string;
  rotate: number;
  delay: number;
};

const particles = [
  { left: "6%", top: "14%", size: 5, delay: 0.2, duration: 7.6 },
  { left: "18%", top: "28%", size: 3, delay: 1.1, duration: 6.3 },
  { left: "24%", top: "72%", size: 4, delay: 0.8, duration: 8.2 },
  { left: "31%", top: "18%", size: 6, delay: 1.6, duration: 6.8 },
  { left: "39%", top: "46%", size: 4, delay: 0.4, duration: 7.4 },
  { left: "48%", top: "10%", size: 5, delay: 1.4, duration: 6.6 },
  { left: "55%", top: "78%", size: 4, delay: 0.7, duration: 7.9 },
  { left: "63%", top: "32%", size: 3, delay: 1.9, duration: 6.4 },
  { left: "71%", top: "16%", size: 5, delay: 0.6, duration: 8.1 },
  { left: "78%", top: "62%", size: 6, delay: 1.3, duration: 7.1 },
  { left: "86%", top: "24%", size: 4, delay: 1.8, duration: 6.7 },
  { left: "92%", top: "74%", size: 5, delay: 0.5, duration: 8.4 },
] as const;

const energyLines: EnergyLine[] = [
  { width: "32%", top: "21%", left: "-6%", rotate: -10, delay: 0.2 },
  { width: "44%", top: "52%", right: "-11%", rotate: -6, delay: 0.8 },
  { width: "24%", top: "80%", left: "16%", rotate: 4, delay: 1.4 },
] as const;

export function BackgroundEffects() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 cyber-grid opacity-70" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(0,255,156,0.12),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.08),_transparent_28%)]" />

      <motion.div
        className="absolute left-[8%] top-24 h-64 w-64 rounded-full bg-[#00ff9c]/10 blur-[130px]"
        animate={{ opacity: [0.3, 0.7, 0.35], scale: [1, 1.18, 0.96] }}
        transition={{ duration: 10, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute right-[5%] top-16 h-72 w-72 rounded-full bg-emerald-400/10 blur-[150px]"
        animate={{ opacity: [0.25, 0.55, 0.3], scale: [1, 0.92, 1.08] }}
        transition={{ duration: 11, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-[-4rem] left-1/2 h-80 w-[30rem] -translate-x-1/2 rounded-full bg-[#00ff9c]/12 blur-[170px]"
        animate={{ opacity: [0.2, 0.5, 0.22], y: [0, -28, 0] }}
        transition={{ duration: 9, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      />

      {energyLines.map((line) => (
        <motion.span
          key={`${line.top}-${line.left ?? line.right ?? ""}`}
          className="absolute h-px rounded-full bg-gradient-to-r from-transparent via-[#6fffc5] to-transparent opacity-60 blur-[1px]"
          style={line}
          animate={{ opacity: [0.15, 0.75, 0.18], scaleX: [0.92, 1.05, 0.94] }}
          transition={{
            duration: 5.8,
            delay: line.delay,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
      ))}

      {particles.map((particle) => (
        <motion.span
          key={`${particle.left}-${particle.top}`}
          className="absolute rounded-full bg-[#7affca]"
          style={{
            left: particle.left,
            top: particle.top,
            width: particle.size,
            height: particle.size,
            boxShadow: "0 0 14px rgba(0, 255, 156, 0.9)",
          }}
          animate={{
            opacity: [0.15, 0.9, 0.2],
            y: [0, -18, 0],
            scale: [0.8, 1.25, 0.9],
          }}
          transition={{
            duration: particle.duration,
            delay: particle.delay,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
