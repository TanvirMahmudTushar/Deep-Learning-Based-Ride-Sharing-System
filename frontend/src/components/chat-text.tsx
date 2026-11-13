import { Fragment, type ReactNode } from "react";

/**
 * Renders the light Markdown a language model tends to produce (bold, italics, inline code,
 * headings, bullet and numbered lists) as React elements. No HTML is injected, so model output
 * can never add markup to the page.
 */

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\s][^*\n]*\*)/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (/^(\*\*|__).+\1$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^`.+`$/.test(part)) return <code key={i} className="rounded bg-background/60 px-1 font-mono text-[0.9em]">{part.slice(1, -1)}</code>;
    if (/^\*.+\*$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

type Block = { kind: "p"; lines: string[] } | { kind: "ul"; items: string[] } | { kind: "ol"; items: string[] } | { kind: "h"; text: string };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const last = out.at(-1);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (!line.trim()) {
      out.push({ kind: "p", lines: [] });
    } else if (heading) {
      out.push({ kind: "h", text: heading[1] });
    } else if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const item = (bullet ?? numbered)![1];
      if (last && last.kind === kind && "items" in last) last.items.push(item);
      else out.push(kind === "ul" ? { kind: "ul", items: [item] } : { kind: "ol", items: [item] });
    } else if (last?.kind === "p") {
      last.lines.push(line);
    } else {
      out.push({ kind: "p", lines: [line] });
    }
  }
  return out.filter((b) => b.kind !== "p" || b.lines.length > 0);
}

export function ChatText({ text }: { text: string }) {
  return (
    <div className="space-y-1.5">
      {blocks(text).map((b, i) => {
        if (b.kind === "h") return <p key={i} className="font-semibold">{inline(b.text)}</p>;
        if ("items" in b) {
          const List = b.kind;
          return (
            <List key={i} className={b.kind === "ul" ? "list-disc space-y-0.5 pl-5" : "list-decimal space-y-0.5 pl-5"}>
              {b.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
