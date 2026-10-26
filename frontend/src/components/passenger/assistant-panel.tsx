"use client";

import { Loader2, SendHorizontal, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { VEHICLE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BookingSuggestion, ChatMessage, ChatResponse } from "@/lib/types";

const STARTERS = ["Bike from Gulshan to Dhanmondi", "Why is my fare higher than usual?", "Which vehicle is best for 3 people?"];

interface Entry extends ChatMessage {
  booking?: BookingSuggestion | null;
  source?: ChatResponse["source"];
}

export function AssistantPanel({ onUseBooking }: { onUseBooking: (b: BookingSuggestion) => void }) {
  const [entries, setEntries] = useState<Entry[]>([
    { role: "assistant", content: "Hi! I can book a ride for you or answer questions about your trip and fares." },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries, sending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    const next: Entry[] = [...entries, { role: "user", content }];
    setEntries(next);
    setInput("");
    setSending(true);
    try {
      const res = await api<ChatResponse>("/api/assistant/chat", {
        json: { messages: next.slice(1).map(({ role, content }) => ({ role, content })) },
      });
      setEntries((e) => [...e, { role: "assistant", content: res.reply, booking: res.booking, source: res.source }]);
    } catch (err) {
      setEntries((e) => [...e, { role: "assistant", content: err instanceof Error ? err.message : "Something went wrong." }]);
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <div className="flex h-full min-h-105 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pb-3">
        {entries.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] space-y-2 rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap",
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              <p>{m.content}</p>
              {m.booking && (
                <div className="space-y-2 rounded-lg border border-border bg-background/60 p-2.5">
                  <div className="text-xs text-muted-foreground">Suggested booking</div>
                  <div className="font-medium">
                    {VEHICLE_LABEL[m.booking.vehicle_type]} · {m.booking.pickup_zone} → {m.booking.drop_zone}
                  </div>
                  <Button size="sm" className="w-full" onClick={() => onUseBooking(m.booking!)}>
                    Use this booking
                  </Button>
                </div>
              )}
              {m.source === "fallback" && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  offline answer
                </Badge>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {entries.length === 1 && (
        <div className="flex flex-wrap gap-2 pb-3">
          {STARTERS.map((s) => (
            <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
              {s}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="flex gap-2 border-t pt-3">
        <div className="relative flex-1">
          <Sparkles className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask or say where to go…" className="pl-8" maxLength={2000} />
        </div>
        <Button type="submit" size="icon" disabled={sending || !input.trim()} aria-label="Send">
          <SendHorizontal />
        </Button>
      </form>
    </div>
  );
}
