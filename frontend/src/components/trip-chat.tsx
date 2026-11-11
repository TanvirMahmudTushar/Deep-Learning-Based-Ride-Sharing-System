"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2, MessageCircle, SendHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, fetcher } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useLiveInterval } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import type { TripMessage } from "@/lib/types";

/**
 * Text chat between a passenger and their rider. `basePath` is `/api/trips/{id}` for the passenger
 * and `/api/rider/trips/{id}` for the rider; messages can be sent only while the trip is under way.
 */
export function TripChat({ basePath, otherName, canSend }: { basePath: string; otherName: string; canSend: boolean }) {
  const key = `${basePath}/messages`;
  const { data: messages, mutate } = useSWR<TripMessage[]>(key, fetcher, { refreshInterval: useLiveInterval(4000, 30000) });
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const theirs = messages?.filter((m) => !m.mine).length ?? 0;
  const unread = open ? 0 : Math.max(0, theirs - seen);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [open, messages?.length]);

  function toggle() {
    // Everything visible while the panel was open counts as read.
    setSeen(theirs);
    setOpen(!open);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      await api(key, { json: { body } });
      setText("");
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Message not sent");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-lg border">
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-sm">
        <span className="inline-flex items-center gap-2 font-medium">
          <MessageCircle className="size-4" /> Message {otherName}
        </span>
        {unread > 0 ? (
          <Badge className="h-5 min-w-5 px-1.5 tabular-nums">{unread}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">{open ? "Hide" : messages?.length ? `${messages.length} messages` : "Open"}</span>
        )}
      </button>
      {open && (
        <div className="space-y-3 border-t p-3">
          <div className="max-h-56 space-y-2 overflow-y-auto" aria-live="polite">
            {messages?.length === 0 && <p className="text-center text-xs text-muted-foreground">No messages yet.</p>}
            {messages?.map((m) => (
              <div key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[80%] rounded-2xl px-3 py-1.5 text-sm", m.mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  <p className="whitespace-pre-wrap text-pretty">{m.body}</p>
                  <p className={cn("mt-0.5 text-[10px]", m.mine ? "text-primary-foreground/70" : "text-muted-foreground")}>{formatDateTime(m.created_at)}</p>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          {canSend ? (
            <form onSubmit={send} className="flex gap-2">
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${otherName}`} maxLength={500} aria-label={`Message ${otherName}`} />
              <Button type="submit" size="icon" disabled={sending || !text.trim()} aria-label="Send">
                {sending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
              </Button>
            </form>
          ) : (
            <p className="text-center text-xs text-muted-foreground">Chat closes when the trip ends.</p>
          )}
        </div>
      )}
    </div>
  );
}
