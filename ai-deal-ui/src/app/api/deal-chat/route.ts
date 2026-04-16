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

// Stub responses keyed by simple keyword matches.
// Replace this function body with a real LLM call when AI_ENABLED=true.
function generateStubReply(
  userMessage: string,
  context: DealChatRequest["dealContext"],
): string {
  const msg = userMessage.toLowerCase();
  const name = context?.dealName ?? context?.address ?? "this deal";
  const score = context?.score;
  const strategy = context?.strategy ?? "unknown strategy";
  const stage = context?.stage ?? "unknown stage";

  if (msg.includes("score") || msg.includes("rating")) {
    return score !== null && score !== undefined
      ? `The current priority score for ${name} is **${score}**. Scores above 85 are flagged as High Value; above 60 as Watchlist. You may want to check if the underlying deal_feed entry has a fresh scoring run.`
      : `No score has been computed for ${name} yet — it doesn't have a deal_feed entry. You can trigger a scoring run from the triage workflow.`;
  }

  if (msg.includes("risk") || msg.includes("concern")) {
    return `Risk review for ${name}: the workspace shows the active risk items in the Risks card. For a full assessment, I'd look at flood exposure from site_intelligence and any open due-diligence tasks. Want me to summarise the highest-severity items?`;
  }

  if (msg.includes("financial") || msg.includes("gdv") || msg.includes("tdc") || msg.includes("margin") || msg.includes("profit")) {
    return `Financials for ${name} are pulled from the latest financial_snapshots row. Key metrics are GDV (gross development value), TDC (total development cost), and derived margin. If those fields are showing "—" it means no snapshot has been logged yet — you can add one via the Supabase dashboard.`;
  }

  if (msg.includes("strategy") || msg.includes("approach")) {
    return `The current strategy for ${name} is **${strategy}**. If you want to change or refine the strategy classification, update the \`strategy\` column on the deals table row.`;
  }

  if (msg.includes("stage") || msg.includes("status")) {
    return `${name} is currently at stage **${stage}**. You can move it between stages (active, archived, etc.) from the Supabase dashboard or via the decision workflow.`;
  }

  if (msg.includes("summar") || msg.includes("overview") || msg.includes("tldr")) {
    const summary = context?.summary;
    return summary
      ? `Here's the deal summary on file: "${summary}". The workspace TLDR bullets above derive from live deal data — score, margin, zoning, and risk flags.`
      : `No summary is stored for ${name} yet. The TLDR section in the workspace is generated from live data fields (score, margin, risks, zoning). You can add a human-written summary to the deal_feed row.`;
  }

  if (msg.includes("next step") || msg.includes("what should") || msg.includes("recommend")) {
    return `For ${name} at stage **${stage}**: typical next steps would be (1) confirm financial snapshot is up to date, (2) close any open due-diligence tasks, (3) run a fresh scoring pass to update priority_score, and (4) log a decision (BUY / REVIEW / PASS) via the decision header above.`;
  }

  if (msg.includes("hello") || msg.includes("hi") || msg.includes("hey")) {
    return `Hi! I'm the deal assistant for ${name}. Ask me about the score, financials, risks, strategy, or next steps for this deal.`;
  }

  return `I can help you analyse ${name}. Try asking about the score, financial metrics (GDV / TDC / margin), risks, current stage, or recommended next steps.`;
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

    // TODO: swap stub for real LLM call when AI_ENABLED=true
    const aiEnabled = process.env.AI_ENABLED === "true";
    let replyContent: string;

    if (aiEnabled) {
      // Placeholder for real AI integration
      replyContent = `[AI integration coming soon] ${generateStubReply(lastUserMessage.content, dealContext)}`;
    } else {
      replyContent = generateStubReply(lastUserMessage.content, dealContext);
    }

    const reply: ChatMessage = { role: "assistant", content: replyContent };
    return NextResponse.json({ message: reply } satisfies DealChatResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
