import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ConnectionCardProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  isActive: boolean;
  badgeText?: string;
  onClick: () => void;
};

export function ConnectionCard({
  title,
  description,
  icon: Icon,
  isActive,
  badgeText,
  onClick,
}: ConnectionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group rounded-2xl border p-5 text-left transition-all duration-300",
        isActive
          ? "border-primary/70 bg-gradient-to-br from-primary/15 to-[#0b1018] shadow-[0_0_24px_rgba(34,197,94,0.24)]"
          : "border-white/10 bg-[#090d15] hover:border-primary/50 hover:shadow-[0_0_14px_rgba(34,197,94,0.15)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="font-heading text-xl font-semibold text-zinc-100">{title}</h3>
            {badgeText ? (
              <Badge className="bg-primary/20 text-primary ring-1 ring-primary/40">{badgeText}</Badge>
            ) : null}
          </div>
          <p className="text-sm leading-relaxed text-zinc-300">{description}</p>
        </div>
        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-white/10 transition-all",
            isActive ? "bg-primary/15 text-primary" : "bg-white/[0.03] text-zinc-400",
          )}
        >
          <Icon className="size-5" />
        </div>
      </div>
    </button>
  );
}
