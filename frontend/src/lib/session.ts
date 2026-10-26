"use client";

import { useSyncExternalStore } from "react";
import type { AuthResponse, Profile } from "@/lib/types";

/**
 * The session (JWT + profile) lives in localStorage and is exposed as an external store, so every
 * component re-renders on login/logout, including across tabs.
 */
const KEY = "ride.session";
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key === KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

let cachedRaw: string | null = null;
let cachedValue: AuthResponse | null = null;

function parse(raw: string | null): AuthResponse | null {
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    cachedValue = raw ? (JSON.parse(raw) as AuthResponse) : null;
  } catch {
    cachedValue = null;
  }
  return cachedValue;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return parse(read())?.token ?? null;
}

export function saveSession(session: AuthResponse) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Storage blocked: the session lasts until reload via the cache below.
    cachedRaw = JSON.stringify(session);
    cachedValue = session;
  }
  emit();
}

/** Keep the stored profile in step after the user edits it. */
export function updateSessionProfile(profile: Profile) {
  const current = parse(read());
  if (current) saveSession({ ...current, profile });
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  emit();
}

type SessionState = { status: "loading" } | { status: "anonymous" } | { status: "authenticated"; profile: Profile };

const LOADING: SessionState = { status: "loading" };
const ANONYMOUS: SessionState = { status: "anonymous" };
let lastSession: AuthResponse | null = null;
let lastState: SessionState = ANONYMOUS;

function snapshot(): SessionState {
  const session = parse(read());
  if (!session) return ANONYMOUS;
  if (session !== lastSession) {
    lastSession = session;
    lastState = { status: "authenticated", profile: session.profile };
  }
  return lastState;
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, snapshot, () => LOADING);
}

export function homeFor(role: Profile["role"]) {
  return role === "admin" ? "/admin" : role === "rider" ? "/rider" : "/user";
}
