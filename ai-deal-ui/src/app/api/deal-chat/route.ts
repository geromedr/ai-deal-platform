import { NextRequest, NextResponse } from "next/server";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type DealChatRequest = {
  dealId: string;
  messages: ChatMessage[];
  dealContext?: {
    dealName?: string | null;
    address?: string | null;
    score?: number | null;
    strategy?: string | null;
    stage?: string | null;
    summary?: string | null;
  };
};

export type DealChatResponse = {
  message: ChatMessage;
  error?: string;
};

function buildSystemPrompt(
  dealId: string,
  context: DealChatRequest["dealContext"],
): string {
  const name = context?.dealName ?? context?.address ?? "this deal";
  const parts: string[] = [
    `You are a deal analysis assistant for a property development platform.`,
    `You are helping an operator review deal ID: ${dealId} — "${name}".`,
  ];

  if (context?.score !== null && context?.score !== undefined) {
    parts.push(`Current priority score: ${context.score}/100.`);
  }
  if (context?.strategy) parts.push(`Strategy: ${context.strategy}.`);
  if (context?.stage) parts.push(`Stage: ${context.stage}.`);
  if (context?.summary) parts.push(`Deal summary: ${context.summary}`);

  parts.push(
    `Answer questions about this deal concisely and accurately. ` +
    `If you don't have enough data to answer something, say so clearly rather than guessing. ` +
    `Use markdown for formatting where helpful.`,
  );

  return parts.join(" ");
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DealChatRequest;
    const { dealId, messages, dealContext } = body;

    if (!dealId || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "dealId and messages are required" },
        { status: 400 },
      );
    }

    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMessage) {
      return NextResponse.json(
        { error: "No user message found" },
        { status: 400 },
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: "Supabase environment variables are not configured." },
        { status: 500 },
      );
    }

    // Build the prompt including conversation history so the agent has context
    const history = messages.slice(0, -1);
    const historyText = history.length > 0
      ? history
          .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
          .join("\n") + "\n\n"
      : "";
    const fullPrompt = `${buildSystemPrompt(dealId, dealContext)}\n\n${historyText}User: ${lastUserMessage.content}`;

    // Call the ai-agent edge function which handles RAG + DeepSeek reasoning
    const agentRes = await fetch(`${supabaseUrl}/functions/v1/ai-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({
        deal_id: dealId,
        prompt: fullPrompt,
        knowledge_query: lastUserMessage.content, // use the raw user question for RAG search
      }),
    });

    let agentJson: Record<string, unknown>;
    try {
      agentJson = (await agentRes.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: `ai-agent returned non-JSON (status ${agentRes.status})` },
        { status: 502 },
      );
    }

    if (!agentRes.ok) {
      const errMsg =
        typeof agentJson.error === "string"
          ? agentJson.error
          : `ai-agent failed (status ${agentRes.status})`;
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }

    // ai-agent returns { ai_result: { text: string }, status, deal_id, ... }
    const aiResult = agentJson.ai_result as Record<string, unknown> | undefined;
    const replyText =
      typeof aiResult?.text === "string" && aiResult.text.trim().length > 0
        ? aiResult.text
        : typeof agentJson.reply === "string"
          ? agentJson.reply
          : typeof agentJson.message === "string"
            ? agentJson.message
            : "I wasn't able to generate a response. Please try again.";

    const reply: ChatMessage = { role: "assistant", content: replyText };
    return NextResponse.json({ message: reply } satisfies DealChatResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
