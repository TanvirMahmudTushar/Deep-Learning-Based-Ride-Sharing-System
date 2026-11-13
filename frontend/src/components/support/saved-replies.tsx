"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ChevronDown, Loader2, MessageSquareText, Pencil, Plus, Settings2, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, fetcher } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { ReportCategory, SafetyAlert, SavedReply } from "@/lib/types";

const KEY = "/api/admin/saved-replies";

export const REPORT_CATEGORY_LABEL: Record<ReportCategory, string> = {
  safety: "Safety",
  driving: "Driving",
  rider_behaviour: "Rider behaviour",
  fare: "Fare",
  lost_item: "Lost item",
  other: "Other",
};

/** Placeholders an agent can put in a reply, and what each becomes for a given case. */
export const PLACEHOLDERS: { token: string; label: string; value: (a: SafetyAlert) => string | null }[] = [
  { token: "{passenger_first_name}", label: "Passenger's first name", value: (a) => a.passenger_name.split(" ")[0] || null },
  { token: "{rider_first_name}", label: "Rider's first name", value: (a) => a.rider_name?.split(" ")[0] ?? null },
  {
    token: "{trip_date}",
    label: "Trip date",
    value: (a) => (a.trip_requested_at ? new Date(a.trip_requested_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null),
  },
  { token: "{pickup}", label: "Pickup", value: (a) => a.pickup_address || null },
  { token: "{drop}", label: "Drop-off", value: (a) => a.drop_address || null },
];

/** Fill a saved reply's placeholders from the case. Anything unknown is left as typed, so the agent notices it. */
export function fillReply(body: string, alert: SafetyAlert): string {
  return PLACEHOLDERS.reduce((text, p) => {
    const value = p.value(alert);
    return value ? text.replaceAll(p.token, value) : text;
  }, body);
}

function useSavedReplies() {
  return useSWR<SavedReply[]>(KEY, fetcher);
}

/** "Saved replies" menu beside the reply box: replies for this report's category first, then the rest. */
export function SavedRepliesMenu({ alert, onPick }: { alert: SafetyAlert; onPick: (text: string) => void }) {
  const { data: replies = [] } = useSavedReplies();
  const [managing, setManaging] = useState(false);
  const category = alert.details.category as ReportCategory | undefined;
  const suggested = replies.filter((r) => category && r.category === category);
  const others = replies.filter((r) => !suggested.includes(r));

  const item = (r: SavedReply) => (
    <DropdownMenuItem key={r.id} onSelect={() => onPick(fillReply(r.body, alert))} className="flex-col items-start gap-0.5">
      <span className="flex w-full items-center gap-2">
        <span className="truncate font-medium">{r.title}</span>
        {r.shared && <Users className="ml-auto size-3.5 text-muted-foreground" aria-label="Team reply" />}
      </span>
      <span className="line-clamp-1 text-xs text-muted-foreground">{r.body}</span>
    </DropdownMenuItem>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <MessageSquareText /> Saved replies <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-96 w-80 overflow-y-auto">
          {suggested.length > 0 && (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground">Suggested for {REPORT_CATEGORY_LABEL[category!]}</DropdownMenuLabel>
              {suggested.map(item)}
              <DropdownMenuSeparator />
            </>
          )}
          {others.length > 0 && <DropdownMenuLabel className="text-xs text-muted-foreground">{suggested.length ? "Other replies" : "Saved replies"}</DropdownMenuLabel>}
          {others.map(item)}
          {replies.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No saved replies yet.</p>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setManaging(true)}>
            <Settings2 /> Manage saved replies
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ManageRepliesDialog open={managing} onOpenChange={setManaging} />
    </>
  );
}

type Draft = { id: string | null; title: string; body: string; category: ReportCategory | "any"; shared: boolean };
const EMPTY: Draft = { id: null, title: "", body: "", category: "any", shared: false };

function ReplyForm({ draft, setDraft, isAdmin, onDone }: { draft: Draft; setDraft: (d: Draft) => void; isAdmin: boolean; onDone: () => void }) {
  const { mutate } = useSavedReplies();
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  /** Put a placeholder at the cursor (or the end), with a space on each side so typing carries on naturally. */
  function insertToken(token: string) {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? draft.body.length;
    const end = el?.selectionEnd ?? start;
    const before = draft.body.slice(0, start);
    const after = draft.body.slice(end);
    const insert = `${before && !/\s$/.test(before) ? " " : ""}${token}${/^\s/.test(after) ? "" : " "}`;
    setDraft({ ...draft, body: before + insert + after });
    const caret = before.length + insert.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  async function save() {
    setSaving(true);
    try {
      const json = { title: draft.title, body: draft.body, category: draft.category === "any" ? null : draft.category, shared: draft.shared };
      await api(draft.id ? `${KEY}/${draft.id}` : KEY, { method: draft.id ? "PUT" : "POST", json });
      await mutate();
      toast.success(draft.id ? "Saved reply updated" : "Saved reply added");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the reply");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
        <div className="space-y-1.5">
          <Label htmlFor="reply-title">Title</Label>
          <Input id="reply-title" value={draft.title} maxLength={60} placeholder="e.g. Lost item: contacting the rider" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Suggest for</Label>
          <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v as Draft["category"] })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any report</SelectItem>
              {(Object.keys(REPORT_CATEGORY_LABEL) as ReportCategory[]).map((c) => (
                <SelectItem key={c} value={c}>
                  {REPORT_CATEGORY_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reply-body">Reply</Label>
        <Textarea ref={bodyRef} id="reply-body" rows={4} maxLength={1000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Insert:
          {PLACEHOLDERS.map((p) => (
            <button
              key={p.token}
              type="button"
              title={p.label}
              // Keep focus (and the cursor) in the reply box when clicked with a mouse.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertToken(p.token)}
              className="rounded border px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent hover:text-foreground"
            >
              {p.token}
            </button>
          ))}
        </div>
      </div>
      {isAdmin && (
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={draft.shared} onCheckedChange={(shared) => setDraft({ ...draft, shared })} />
          Share with the whole support team
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" disabled={saving || draft.title.trim().length < 2 || draft.body.trim().length < 3} onClick={() => void save()}>
          {saving && <Loader2 className="animate-spin" />} {draft.id ? "Save changes" : "Add reply"}
        </Button>
      </div>
    </div>
  );
}

/** Add, edit and delete saved replies. Agents manage their own; admins also manage team replies. */
export function ManageRepliesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: replies, mutate } = useSavedReplies();
  const session = useSession();
  const isAdmin = session.status === "authenticated" && session.profile.role === "admin";
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function remove(r: SavedReply) {
    setDeleting(r.id);
    try {
      await api(`${KEY}/${r.id}`, { method: "DELETE" });
      await mutate();
      toast.success("Saved reply deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the reply");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setDraft(null);
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Saved replies</DialogTitle>
          <DialogDescription>
            Placeholders like {"{passenger_first_name}"} are filled in from the case when you pick a reply. You can edit the text before sending.
            {!isAdmin && " Team replies are managed by admins."}
          </DialogDescription>
        </DialogHeader>

        {draft ? (
          <ReplyForm draft={draft} setDraft={setDraft} isAdmin={isAdmin} onDone={() => setDraft(null)} />
        ) : (
          <Button size="sm" variant="outline" className="w-fit" onClick={() => setDraft({ ...EMPTY, shared: false })}>
            <Plus /> New saved reply
          </Button>
        )}

        <ul className="space-y-2">
          {replies?.map((r) => (
            <li key={r.id} className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.title}</span>
                <Badge variant="outline" className="text-[10px]">
                  {r.shared ? "Team" : "Yours"}
                </Badge>
                {r.category && (
                  <Badge variant="secondary" className="text-[10px]">
                    {REPORT_CATEGORY_LABEL[r.category]}
                  </Badge>
                )}
                {r.can_edit && (
                  <span className="ml-auto flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={`Edit ${r.title}`}
                      onClick={() => setDraft({ id: r.id, title: r.title, body: r.body, category: r.category ?? "any", shared: r.shared })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-7" aria-label={`Delete ${r.title}`} disabled={deleting === r.id} onClick={() => void remove(r)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap text-pretty text-muted-foreground">{r.body}</p>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
