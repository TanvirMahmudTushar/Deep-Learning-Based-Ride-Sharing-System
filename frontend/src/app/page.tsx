"use client";

import Link from "next/link";
import { Logo } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { homeFor, useSession } from "@/lib/session";

export default function Home() {
  const session = useSession();

  return (
    <div className="relative grid h-dvh place-items-center overflow-hidden px-6">
      <Logo className="aspect-video w-full max-w-xl" />
      <header className="absolute inset-x-0 top-0 z-10 flex h-16 items-center bg-gradient-to-b from-background/80 to-transparent px-4 sm:px-6">
        <span className="font-semibold tracking-tight">Cholo</span>
        <div className="ml-auto flex gap-2">
          {session.status === "authenticated" ? (
            <Button asChild>
              <Link href={homeFor(session.profile.role)}>Open my portal</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild>
                <Link href="/register">Sign up</Link>
              </Button>
            </>
          )}
        </div>
      </header>
    </div>
  );
}
