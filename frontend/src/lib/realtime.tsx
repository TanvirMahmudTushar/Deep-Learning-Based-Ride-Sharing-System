"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { API_URL } from "@/lib/api";
import { chime, showSystemNotification } from "@/lib/notifications";
import { getToken, useSession } from "@/lib/session";

/**
 * One WebSocket per signed-in browser tab. Server events are "refresh these" signals: each event
 * type revalidates the SWR keys that depend on it, so the REST API stays the source of truth.
 * Pages keep a slow polling fallback that speeds up when the socket is down.
 */

interface ServerEvent {
  type: string;
  notify?: { title: string; body: string };
  [key: string]: unknown;
}

const EVENT_KEYS: Record<string, string[]> = {
  "trip.updated": ["/api/trips", "/api/rider/active", "/api/rider/offer", "/api/rider/me", "/api/rider/pending-payment", "/api/rider/trips", "/api/passenger"],
  "trip.location": ["/api/trips/active", "/api/trips/"],
  "offer.new": ["/api/rider/offer"],
  "offer.closed": ["/api/rider/offer"],
  "live.changed": ["/api/admin/trips/live", "/api/admin/stats", "/api/admin/forecasts"],
  "alert.new": ["/api/admin/alerts", "/api/admin/stats"],
  "riders.changed": ["/api/admin/riders", "/api/admin/stats"],
  "profile.updated": ["/api/rider/me", "/api/rider/documents"],
  "earnings.updated": ["/api/rider/earnings", "/api/rider/me"],
  "payments.changed": ["/api/admin/payments", "/api/admin/stats"],
};

/** Events worth a sound even when the tab is visible. */
const URGENT = new Set(["offer.new", "alert.new"]);

const RealtimeContext = createContext({ connected: false });

export function useRealtime() {
  return useContext(RealtimeContext);
}

/** Polling interval to use alongside the socket: slow when live, fast when disconnected. */
export function useLiveInterval(fastMs = 3000, slowMs = 30000) {
  return useRealtime().connected ? slowMs : fastMs;
}

function wsUrl() {
  return `${API_URL.replace(/^http/, "ws")}/ws`;
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const { mutate } = useSWRConfig();
  const [connected, setConnected] = useState(false);
  const profileId = session.status === "authenticated" ? session.profile.id : null;

  useEffect(() => {
    if (!profileId) return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const revalidate = (prefixes: string[]) =>
      mutate((key) => typeof key === "string" && prefixes.some((p) => key.startsWith(p)), undefined, { revalidate: true });

    const handle = (event: ServerEvent) => {
      const prefixes = EVENT_KEYS[event.type];
      if (prefixes) void revalidate(prefixes);
      if (event.notify) {
        toast(event.notify.title, { description: event.notify.body });
        if (URGENT.has(event.type) || document.visibilityState !== "visible") chime();
        showSystemNotification(event.notify.title, event.notify.body);
      }
    };

    const connect = () => {
      ws = new WebSocket(wsUrl());
      ws.onopen = () => ws?.send(JSON.stringify({ type: "auth", token: getToken() }));
      ws.onmessage = (e) => {
        let event: ServerEvent;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }
        if (event.type === "ready") {
          attempt = 0;
          setConnected(true);
          void revalidate(["/api/"]); // catch up on anything missed while disconnected
        } else if (event.type !== "pong") {
          handle(event);
        }
      };
      ws.onclose = (e) => {
        setConnected(false);
        if (stopped || e.code === 4401) return;
        retryTimer = setTimeout(connect, Math.min(15000, 1000 * 2 ** attempt++));
      };
    };

    connect();
    const ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25000);
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(ping);
      ws?.close();
    };
  }, [profileId, mutate]);

  return <RealtimeContext.Provider value={{ connected: connected && !!profileId }}>{children}</RealtimeContext.Provider>;
}
