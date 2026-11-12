"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { api, fetcher } from "@/lib/api";
import type { ServerHealth } from "@/lib/types";

/** Server mode and feature flags (demo mode, simulator, geocoding, upload limit). */
export function useServerHealth() {
  return useSWR<ServerHealth>("/api/health", fetcher, { revalidateOnFocus: false, dedupingInterval: 60000 });
}

/** Fetch a protected file (rider document) and return an object URL for <img> / <a href>. */
export async function fetchFileUrl(path: string): Promise<string> {
  const blob = await api<Blob>(path, { raw: true });
  return URL.createObjectURL(blob);
}

/** React hook that resolves a protected API file path into a revocable object URL. */
export function useAuthFileUrl(path?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    fetchFileUrl(path)
      .then((resolved) => {
        if (!active) {
          URL.revokeObjectURL(resolved);
          return;
        }
        objectUrl = resolved;
        setUrl(resolved);
      })
      .catch(() => {
        if (active) setUrl(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return url;
}
