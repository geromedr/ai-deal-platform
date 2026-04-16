"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChatMessage, DealChatRequest } from "@/app/api/deal-chat/route";

type DealChatProps = {
  dealId: string;
  dealContext?: DealChatRequest["dealContext"];
};

const STARTER_PROMPTS = [
  "What's the score for this deal?",
  "Summarise the key risks",
  "Show me the financials",
  "What are the recommended next steps?",
];

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`flex size-7 shrink-0 items-center justify-center rounded-full border ${
          isUser ? "border-primary/30 bg-primary/10 text-primary" : "border-border/70 bg-muted text-muted-foreground"
        }`}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-tl-sm border border-border/70 bg-background text-foreground"
        }`}
        // Simple markdown bold: **text** → <strong>text</strong>
        dangerouslySetInnerHTML={{
          __html: message.content
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/\n/g, "<br />"),
        }}
      />
    </div>
  );
}

export default function DealChat({ dealId, dealContext }: DealChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMessage: ChatMessage = { role: "user", content: trimmed };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/deal-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          messages: nextMessages,
          dealContext,
        } satisfies DealChatRequest),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      const data = (await res.json()) as { message: ChatMessage };
      setMessages((prev) => [...prev, data.message]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  const showStarters = messages.length === 0 && !loading;

  return (
    <Card className="border-border/70 bg-card/95">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          Deal Assistant
        </CardTitle>
        <CardDescription>
          Ask questions about this deal — score, financials, risks, or next steps.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Starter prompts */}
        {showStarters ? (
          <div className="flex flex-wrap gap-2">
            {STARTER_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => void sendMessage(prompt)}
                className="rounded-full border border-border/70 bg-background px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:bg-muted hover:text-foreground"
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}

        {/* Message list */}
        {messages.length > 0 ? (
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto pr-1">
            {messages.map((msg, i) => (
              <MessageBubble key={i} message={msg} />
            ))}
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Thinking…
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        ) : null}

        {/* Error */}
        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        {/* Input row */}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this deal…"
            disabled={loading}
            className="flex-1 resize-none rounded-xl border border-border/70 bg-background px-3.5 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
            style={{ minHeight: "42px", maxHeight: "120px" }}
          />
          <Button
            size="sm"
            disabled={!input.trim() || loading}
            onClick={() => void sendMessage(input)}
            className="mb-px shrink-0"
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Press <kbd className="rounded border border-border/70 px-1 py-0.5 font-mono text-[10px]">Enter</kbd> to send · <kbd className="rounded border border-border/70 px-1 py-0.5 font-mono text-[10px]">Shift+Enter</kbd> for new line
        </p>
      </CardContent>
    </Card>
  );
}
