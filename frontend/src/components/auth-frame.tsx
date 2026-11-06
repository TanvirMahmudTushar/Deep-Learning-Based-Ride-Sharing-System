"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Brand } from "@/components/app-shell";
import { landingFor, useSession } from "@/lib/session";

/** Page frame for login and sign-up. Anyone already signed in goes straight to their own portal. */
export function AuthFrame({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const role = session.status === "authenticated" ? session.profile.role : null;

  useEffect(() => {
    if (role) router.replace(landingFor(role, next));
  }, [role, next, router]);

  if (role) return null;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-14 items-center border-b px-4 sm:px-6">
        <Brand />
      </header>
      <main className="grid flex-1 place-items-center px-4 py-10">{children}</main>
    </div>
  );
}
