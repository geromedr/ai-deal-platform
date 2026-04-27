/**
 * Unit tests for /api/deal-chat route handler logic.
 *
 * We test the input validation and response shaping in isolation.
 * The actual ai-agent fetch is mocked so no network calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../deal-chat/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/deal-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Input validation ──────────────────────────────────────────────────────────

describe("POST /api/deal-chat — validation", () => {
  it("returns 400 when dealId is missing", async () => {
    const req = makeRequest({ messages: [{ role: "user", content: "hi" }] });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("dealId");
  });

  it("returns 400 when messages is not an array", async () => {
    const req = makeRequest({ dealId: "abc", messages: "not-an-array" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when no user message exists in messages", async () => {
    const req = makeRequest({
      dealId: "abc",
      messages: [{ role: "assistant", content: "hello" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("user message");
  });

  it("returns 500 when env vars are missing", async () => {
    // Temporarily remove env vars
    const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const origKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const req = makeRequest({
      dealId: "deal-123",
      messages: [{ role: "user", content: "what is the score?" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(500);

    // Restore
    if (origUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
    if (origKey) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origKey;
  });
});

// ── Happy path (mocked ai-agent) ──────────────────────────────────────────────

describe("POST /api/deal-chat — success", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

    // Mock fetch to simulate ai-agent response
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          deal_id: "deal-123",
          ai_result: { text: "The score is 75.", model: "deepseek", usage: {} },
        }),
      }),
    );
  });

  it("returns assistant message on success", async () => {
    const req = makeRequest({
      dealId: "deal-123",
      messages: [{ role: "user", content: "what is the score?" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message.role).toBe("assistant");
    expect(body.message.content).toBe("The score is 75.");
  });

  it("passes deal context to the prompt", async () => {
    const req = makeRequest({
      dealId: "deal-123",
      messages: [{ role: "user", content: "summarise this deal" }],
      dealContext: { dealName: "12 Arbor Street", score: 78, strategy: "townhouse" },
    });
    await POST(req);

    // Verify the fetch was called with a prompt containing deal context
    const fetchCall = (vi.mocked(fetch).mock.calls[0] as unknown[])[1] as RequestInit;
    const body = JSON.parse(fetchCall.body as string);
    expect(body.prompt).toContain("12 Arbor Street");
    expect(body.prompt).toContain("78");
  });
});

// ── ai-agent error handling ───────────────────────────────────────────────────

describe("POST /api/deal-chat — ai-agent errors", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  });

  it("returns 502 when ai-agent returns non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "DeepSeek quota exceeded" }),
      }),
    );

    const req = makeRequest({
      dealId: "deal-123",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("DeepSeek quota exceeded");
  });

  it("returns 502 when ai-agent returns non-JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => { throw new Error("not JSON"); },
      }),
    );

    const req = makeRequest({
      dealId: "deal-123",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(502);
  });

  it("returns fallback message when ai_result.text is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: "success", ai_result: {} }),
      }),
    );

    const req = makeRequest({
      dealId: "deal-123",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message.content).toContain("wasn't able to generate");
  });
});
