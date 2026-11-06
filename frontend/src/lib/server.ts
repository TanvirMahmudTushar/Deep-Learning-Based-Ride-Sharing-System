"use client";

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
