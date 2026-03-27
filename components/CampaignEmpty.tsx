import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type CampaignEmptyProps = {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

export function CampaignEmpty({
  title = "Nenhuma campanha criada ainda.",
  description,
  actionLabel,
  onAction,
  className,
}: CampaignEmptyProps) {
  return (
    <Card
      className={cn(
        "flex min-h-[250px] items-center justify-center rounded-3xl px-6 py-12",
        className,
      )}
    >
      <div className="flex max-w-xl flex-col items-center gap-4 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-white/[0.03] ring-1 ring-white/10">
          <Megaphone className="size-8 text-zinc-500" />
        </div>
        <h3 className="font-heading text-2xl font-semibold text-zinc-100">{title}</h3>
        {description ? <p className="text-zinc-400">{description}</p> : null}
        {actionLabel ? (
          <Button type="button" className="mt-2" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
