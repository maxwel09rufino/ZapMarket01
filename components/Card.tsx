import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type MetricCardProps = {
  title: string;
  value: number;
  icon: LucideIcon;
  iconColorClassName: string;
  iconBgClassName: string;
  isLoading?: boolean;
};

export function MetricCard({
  title,
  value,
  icon: Icon,
  iconColorClassName,
  iconBgClassName,
  isLoading = false,
}: MetricCardProps) {
  return (
    <Card className="group rounded-3xl p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_16px_34px_rgba(34,197,94,0.12)]">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[1.12rem] font-medium leading-tight text-zinc-300">{title}</p>
          <p className="mt-3 text-[2.6rem] font-bold leading-none text-zinc-50">
            {isLoading ? (
              <span className="inline-block min-w-8 animate-pulse rounded bg-white/10 px-1">
                0
              </span>
            ) : (
              value.toLocaleString("pt-BR")
            )}
          </p>
        </div>
        <div
          className={cn(
            "flex size-[52px] items-center justify-center rounded-2xl ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-105",
            iconBgClassName,
          )}
        >
          <Icon className={cn("size-6", iconColorClassName)} />
        </div>
      </div>
    </Card>
  );
}
