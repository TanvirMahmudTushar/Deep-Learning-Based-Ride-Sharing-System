"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Bell, BellOff, BellRing, LogOut, Route } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNotificationPermission } from "@/lib/notifications";
import { useRealtime } from "@/lib/realtime";
import { clearSession, homeFor, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { Profile, Role } from "@/lib/types";

const PORTAL_NAME: Record<Role, string> = { user: "Passenger", rider: "Rider", admin: "Admin" };

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Route className="size-4" />
      </span>
      DeepRide
    </Link>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function UserMenu({ profile }: { profile: Profile }) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2">
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">{initials(profile.full_name)}</AvatarFallback>
          </Avatar>
          <span className="hidden text-sm sm:inline">{profile.full_name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span>{profile.full_name}</span>
          <span className="text-xs font-normal text-muted-foreground">{profile.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            clearSession();
            router.replace("/login");
          }}
        >
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LiveIndicator() {
  const { connected } = useRealtime();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex" role="status">
          <span className={cn("size-2 rounded-full", connected ? "bg-emerald-400" : "animate-pulse bg-amber-400")} />
          {connected ? "Live" : "Reconnecting"}
        </span>
      </TooltipTrigger>
      <TooltipContent>{connected ? "Real-time updates are on" : "Live connection lost; refreshing every few seconds"}</TooltipContent>
    </Tooltip>
  );
}

function NotificationButton() {
  const { permission, request } = useNotificationPermission();
  if (permission === "unsupported") return null;
  const label =
    permission === "granted" ? "Notifications are on" : permission === "denied" ? "Notifications are blocked in your browser settings" : "Turn on notifications";
  const Icon = permission === "granted" ? BellRing : permission === "denied" ? BellOff : Bell;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={permission === "default" ? request : undefined}>
          <Icon className={cn(permission === "default" && "text-amber-300")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export interface NavItem {
  href: string;
  label: string;
}

function PortalNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1" aria-label="Portal">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={pathname === item.href ? "page" : undefined}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-sm transition-colors",
            pathname === item.href ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** Page frame for a role's portal: redirects anonymous visitors to login. */
export function PortalShell({
  role,
  children,
  actions,
  nav,
}: {
  role: Role;
  children: (profile: Profile) => ReactNode;
  actions?: ReactNode;
  nav?: NavItem[];
}) {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session.status === "anonymous") router.replace("/login");
  }, [session.status, router]);

  if (session.status !== "authenticated") {
    return (
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center border-b px-4">
          <Brand />
        </header>
        <div className="grid flex-1 gap-4 p-6 md:grid-cols-[380px_1fr]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  const { profile } = session;
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
        <Brand />
        <Badge variant="secondary" className="hidden sm:inline-flex">
          {PORTAL_NAME[role]} portal
        </Badge>
        {nav && <PortalNav items={nav} />}
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <LiveIndicator />
          <NotificationButton />
          <UserMenu profile={profile} />
        </div>
      </header>
      {profile.role === role ? (
        children(profile)
      ) : (
        <div className="grid flex-1 place-items-center p-6 text-center">
          <div className="space-y-3">
            <p className="text-muted-foreground">
              You are signed in as a {PORTAL_NAME[profile.role].toLowerCase()}. This page is the {PORTAL_NAME[role].toLowerCase()} portal.
            </p>
            <Button asChild>
              <Link href={homeFor(profile.role)}>Go to the {PORTAL_NAME[profile.role].toLowerCase()} portal</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
