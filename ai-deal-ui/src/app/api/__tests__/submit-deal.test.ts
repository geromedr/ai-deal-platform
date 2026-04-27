/**
 * Unit tests for /api/submit-deal route handler logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock callEdgeFunction before importing the route
vi.mock("@/lib/api/callEdgeFunction", () => ({
  callEdgeFunction: vi.fn(),
}));

import { POST } from "../submit-deal/route";
import { callEdgeFunction } from "@/lib/api/callEdgeFunction";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/submit-deal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/submit-deal — validation", () => {
  it("returns 400 when address is missing", async () => {
    const req = makeRequest({ suburb: "Geelong" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("address");
  });

  it("returns 400 when address is empty string", async () => {
    const req = makeRequest({ address: "   " });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/submit-deal — success", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  });

  it("returns success with deal_id on valid submission", async () => {
    vi.mocked(callEdgeFunction).mockResolvedValueOnce({
      results: [{ deal_id: "abc-123", address: "12 Arbor St", warnings: [] }],
    });

    const req = makeRequest({ address: "12 Arbor Street, Geelong VIC" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deal_id).toBe("abc-123");
  });

  it("passes optional fields to edge function", async () => {
    vi.mocked(callEdgeFunction).mockResolvedValueOnce({
      results: [{ deal_id: "abc-456", address: "5 Test Road" }],
    });

    const req = makeRequest({
      address: "5 Test Road",
      suburb: "Fitzroy",
      state: "VIC",
      postcode: "3065",
    });
    await POST(req);

    expect(callEdgeFunction).toHaveBeenCalledWith(
      "site-discovery-agent",
      expect.objectContaining({
        candidates: expect.arrayContaining([
          expect.objectContaining({
            address: "5 Test Road",
            suburb: "Fitzroy",
            state: "VIC",
            postcode: "3065",
          }),
        ]),
      }),
    );
  });
});

describe("POST /api/submit-deal — error handling", () => {
  it("returns 422 when site-discovery-agent returns an error on the result", async () => {
    vi.mocked(callEdgeFunction).mockResolvedValueOnce({
      results: [{ error: "Address not found" }],
    });

    const req = makeRequest({ address: "Unknown Address" });
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("Address not found");
  });

  it("returns 500 when callEdgeFunction throws", async () => {
    vi.mocked(callEdgeFunction).mockRejectedValueOnce(new Error("Network error"));

    const req = makeRequest({ address: "12 Arbor St" });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Network error");
  });
});
