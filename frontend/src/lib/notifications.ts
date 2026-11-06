"use client";

import { useCallback, useState } from "react";

export type NotifyPermission = NotificationPermission | "unsupported";

export function currentPermission(): NotifyPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotifyPermission>(currentPermission);
  const request = useCallback(async () => {
    if (!("Notification" in window)) return;
    setPermission(await Notification.requestPermission());
    chime(); // the click is a user gesture, which also unlocks audio for later chimes
  }, []);
  return { permission, request };
}

/** System notification, only when the tab is in the background (in-app toasts cover the rest). */
export function showSystemNotification(title: string, body: string) {
  if (currentPermission() !== "granted" || (document.visibilityState === "visible" && document.hasFocus())) return;
  try {
    const n = new Notification(title, { body, icon: "/favicon.ico", tag: title });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Some browsers only allow notifications from a service worker; the toast still shows.
  }
}

let audio: AudioContext | null = null;

/** A short two-tone chime made with WebAudio (no sound file needed). */
export function chime() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const now = audio.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.3);
      osc.connect(gain).connect(audio!.destination);
      osc.start(now + i * 0.16);
      osc.stop(now + i * 0.16 + 0.32);
    });
  } catch {
    // Audio blocked until the user interacts with the page.
  }
}
