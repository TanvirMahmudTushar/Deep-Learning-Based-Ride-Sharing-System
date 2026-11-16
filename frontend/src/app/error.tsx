"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Shown instead of a blank page when something on a screen throws. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid flex-1 place-items-center px-4 py-16 text-center">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">Try again. If it keeps happening, go back to the home page.</p>
        <div className="flex justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/">Home</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
