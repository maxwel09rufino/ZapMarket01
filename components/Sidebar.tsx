"use client";

import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Megaphone,
  Package,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

type SidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
};

type MenuItem = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  href?: string;
  statusDot?: boolean;
};

const menuItems: MenuItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { label: "Assistente", icon: Sparkles, href: "/assistente" },
  { label: "Produtos", icon: Package, href: "/produtos" },
  { label: "Contatos", icon: Users, href: "/contatos" },
  { label: "Campanhas", icon: Megaphone, href: "/campanhas" },
  { label: "Conexao WhatsApp", icon: Smartphone, href: "/whatsapp", statusDot: true },
  { label: "Bot WhatsApp", icon: Bot, href: "/bot-whatsapp" },
  { label: "Configuracoes", icon: SlidersHorizontal, href: "/configuracoes" },
];

type SidebarContentProps = {
  collapsed: boolean;
  mobile: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
};

type SessionUser = {
  name: string;
  plan?: string;
};

function getUserInitials(name: string | undefined) {
  const normalized = String(name ?? "").trim();
  if (!normalized) {
    return "ZM";
  }

  const parts = normalized.split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "ZM";
}

function SidebarContent({
  collapsed,
  mobile,
  onToggleCollapse,
  onCloseMobile,
}: SidebarContentProps) {
  const pathname = usePathname();
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
        });

        const payload = (await response.json().catch(() => null)) as
          | {
              authenticated?: boolean;
              user?: SessionUser;
            }
          | null;

        if (!cancelled && payload?.authenticated && payload.user) {
          setSessionUser(payload.user);
        }
      } catch {
        if (!cancelled) {
          setSessionUser(null);
        }
      }
    };

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } finally {
      window.location.href = "/login";
    }
  };

  const renderMenuItem = (item: MenuItem) => {
    const isNavigable = Boolean(item.href);
    const isActive = isNavigable && item.href ? pathname.startsWith(item.href) : false;
    const sharedClassName = cn(
      "group flex w-full items-center rounded-xl text-left transition-all",
      isActive
        ? "bg-gradient-to-r from-primary/25 to-primary/5 text-primary ring-1 ring-primary/35"
        : "text-zinc-300 hover:bg-white/5 hover:text-zinc-100",
      collapsed && !mobile ? "justify-center px-2 py-3" : "justify-between px-4 py-3.5",
    );

    const content = (
      <>
        <span className={cn("flex items-center", collapsed && !mobile ? "gap-0" : "gap-3")}>
          <span className="relative">
            <item.icon className="size-[1.15rem] shrink-0" />
            {item.statusDot && collapsed && !mobile ? (
              <span className="absolute -bottom-1.5 -right-1.5 size-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.75)]" />
            ) : null}
          </span>
          <span className={cn("text-[1.08rem] font-medium", collapsed && !mobile && "hidden")}>
            {item.label}
          </span>
        </span>
        {item.statusDot && !(collapsed && !mobile) ? (
          <span className="size-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.75)]" />
        ) : null}
      </>
    );

    if (!isNavigable || !item.href) {
      return (
        <button key={item.label} type="button" className={sharedClassName} title={collapsed && !mobile ? item.label : undefined}>
          {content}
        </button>
      );
    }

    return (
      <Link
        key={item.label}
        href={item.href}
        prefetch
        className={sharedClassName}
        title={collapsed && !mobile ? item.label : undefined}
        onClick={mobile ? onCloseMobile : undefined}
      >
        {content}
      </Link>
    );
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className={cn("flex items-center gap-3", collapsed && !mobile && "justify-center")}>
          <div className="flex size-12 items-center justify-center rounded-2xl bg-[#0a1610] shadow-[0_0_30px_rgba(34,197,94,0.25)]">
            <Sparkles className="size-5 text-primary" />
          </div>
          <div className={cn("space-y-0.5", collapsed && !mobile && "hidden")}>
            <p className="font-heading text-[1.65rem] font-bold leading-none tracking-tight">
              ZapMarket
            </p>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/90">
              Automation
            </p>
          </div>
        </div>

        <button
          type="button"
          aria-label={mobile ? "Fechar menu" : "Expandir ou recolher menu"}
          onClick={mobile ? onCloseMobile : onToggleCollapse}
          className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-zinc-300 transition-colors hover:bg-white/10 hover:text-zinc-100"
        >
          {mobile ? (
            <X className="size-4" />
          ) : collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronLeft className="size-4" />
          )}
        </button>
      </div>

      <nav className={cn("space-y-1.5", collapsed && !mobile ? "mt-8" : "mt-11")}>
        {menuItems.map(renderMenuItem)}
      </nav>

      <div className="mt-auto rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div
          className={cn(
            "flex items-center gap-3",
            collapsed && !mobile ? "justify-center" : "justify-start",
          )}
        >
          <Avatar className="size-10 ring-2 ring-primary/20">
            <AvatarFallback>{getUserInitials(sessionUser?.name)}</AvatarFallback>
          </Avatar>
          <div className={cn("min-w-0 flex-1", collapsed && !mobile && "hidden")}>
            <p className="truncate font-semibold text-zinc-100">
              {sessionUser?.name ?? "Carregando..."}
            </p>
            <Badge variant="secondary" className="mt-1 text-[11px]">
              {sessionUser?.plan ?? "Pro Plan"}
            </Badge>
          </div>
        </div>

        {collapsed && !mobile ? null : (
          <button
            type="button"
            onClick={handleLogout}
            disabled={isSigningOut}
            className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-primary/35 hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSigningOut ? "Saindo..." : "Sair"}
          </button>
        )}
      </div>
    </>
  );
}

export function Sidebar({
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onCloseMobile,
}: SidebarProps) {
  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[2px] lg:hidden"
          onClick={onCloseMobile}
          aria-label="Fechar menu lateral"
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[290px] flex-col border-r border-white/10 bg-[#05080f]/95 px-6 py-7 backdrop-blur-xl transition-transform duration-300 lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <SidebarContent
          collapsed={false}
          mobile
          onToggleCollapse={onToggleCollapse}
          onCloseMobile={onCloseMobile}
        />
      </aside>

      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-white/10 bg-[#05080f]/90 py-7 backdrop-blur-xl transition-[width,padding] duration-300 lg:flex",
          collapsed ? "w-[96px] px-3" : "w-[290px] px-6",
        )}
      >
        <SidebarContent
          collapsed={collapsed}
          mobile={false}
          onToggleCollapse={onToggleCollapse}
          onCloseMobile={onCloseMobile}
        />
      </aside>
    </>
  );
}
