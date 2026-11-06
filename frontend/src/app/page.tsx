"use client";

import Link from "next/link";
import { Logo, Wordmark } from "@/components/app-shell";
import { VehicleIcon } from "@/components/ride-bits";
import { Button } from "@/components/ui/button";
import { VEHICLE_BLURB, VEHICLE_LABEL } from "@/lib/format";
import { homeFor, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { VehicleType } from "@/lib/types";

const VEHICLES: VehicleType[] = ["bike", "cng", "car"];

export default function Home() {
  const session = useSession();
  const myRole = session.status === "authenticated" ? session.profile.role : null;

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center px-4 sm:px-6">
          <Wordmark className="text-4xl" />
          {/* Hidden until the session is known, so a logged-in visitor never sees "Log in" flash by. */}
          <div className={cn("ml-auto flex gap-2", session.status === "loading" && "invisible")}>
            {myRole ? (
              <Button asChild>
                <Link href={homeFor(myRole)}>Open my portal</Link>
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
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-10 text-center sm:px-6">
          <Logo className="aspect-video w-full max-w-md" />
         
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">Let’s go, Dhaka.</h1>
          <p className="mt-5 max-w-xl text-lg text-pretty text-muted-foreground">
            Book a bike, CNG or car, see the fare before you confirm, and follow your rider on a live map all the way there.
          </p>
          <div className={cn("mt-8 flex flex-wrap justify-center gap-3", session.status === "loading" && "invisible")}>
            {myRole ? (
              <Button size="lg" asChild className="bg-route text-background hover:bg-route/90">
                <Link href={homeFor(myRole)}>Open my portal</Link>
              </Button>
            ) : (
              <>
                <Button size="lg" asChild className="bg-route text-background hover:bg-route/90">
                  <Link href="/register?as=user">Book a ride</Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/register?as=rider">Drive with Cholo</Link>
                </Button>
              </>
            )}
          </div>
        </section>

        <section aria-label="Vehicle types" className="border-t bg-card/40">
          <ul className="mx-auto grid w-full max-w-6xl divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {VEHICLES.map((type) => (
              <li key={type} className="flex items-center gap-4 px-4 py-6 sm:px-6">
                <VehicleIcon type={type} className="size-7 shrink-0 text-route" aria-hidden />
                <div>
                  <p className="font-medium">{VEHICLE_LABEL[type]}</p>
                  <p className="text-sm text-muted-foreground">{VEHICLE_BLURB[type]}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
