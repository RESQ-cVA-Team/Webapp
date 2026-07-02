import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SSE bus uses globalThis maps to persist state across Next.js module hot-reloads.
// Reset them between tests by patching globalThis directly before importing.
function clearGlobalSseBusMaps() {
  const g = globalThis as Record<string, unknown>;
  delete g.sseSubscribersBySender;
  delete g.sseBufferedPayloadsBySender;
  delete g.sseCommittedCursorBySender;
}

beforeEach(() => {
  clearGlobalSseBusMaps();
  vi.resetModules();
});

afterEach(() => {
  clearGlobalSseBusMaps();
  vi.restoreAllMocks();
});

async function freshBus() {
  return await import("@/lib/sseBus");
}

describe("publishToSender / addSubscriberForSender", () => {
  it("delivers payload to active subscriber immediately", async () => {
    const bus = await freshBus();
    const received: unknown[] = [];
    bus.addSubscriberForSender("sender-1", (p) => received.push(p));
    bus.publishToSender("sender-1", { text: "hello" });
    expect(received).toEqual([{ text: "hello" }]);
  });

  it("delivers nothing to subscriber for a different senderId", async () => {
    const bus = await freshBus();
    const received: unknown[] = [];
    bus.addSubscriberForSender("sender-a", (p) => received.push(p));
    bus.publishToSender("sender-b", { text: "not for you" });
    expect(received).toHaveLength(0);
  });

  it("replays buffered payloads to a late subscriber", async () => {
    const bus = await freshBus();
    bus.publishToSender("sender-1", { text: "buffered-1" });
    bus.publishToSender("sender-1", { text: "buffered-2" });

    const received: unknown[] = [];
    bus.addSubscriberForSender("sender-1", (p) => received.push(p));

    expect(received).toEqual([{ text: "buffered-1" }, { text: "buffered-2" }]);
  });

  it("unsubscribe stops delivery", async () => {
    const bus = await freshBus();
    const received: unknown[] = [];
    const unsubscribe = bus.addSubscriberForSender("sender-1", (p) => received.push(p));
    unsubscribe();
    bus.publishToSender("sender-1", { text: "after unsub" });
    expect(received).toHaveLength(0);
  });

  it("normalizes senderId by trimming whitespace", async () => {
    const bus = await freshBus();
    const received: unknown[] = [];
    bus.addSubscriberForSender("  sender-1  ", (p) => received.push(p));
    bus.publishToSender("sender-1", { text: "trimmed" });
    expect(received).toEqual([{ text: "trimmed" }]);
  });
});

describe("setCommittedCursorFloor", () => {
  it("sets the floor and only advances it", async () => {
    const bus = await freshBus();
    bus.setCommittedCursorFloor("sender-1", 5);
    // Trying to lower it should have no effect — we confirm by publishing
    // items at index 3 which should be filtered out.
    const received: unknown[] = [];
    bus.addSubscriberForSender("sender-1", (p) => received.push(p));

    bus.publishCommittedHistoryItems(
      "sender-1",
      [
        { role: "assistant", text: "msg", feedbackKey: "bot:3", debug: { eventIndex: 3, turnIndex: 1 } },
        { role: "assistant", text: "msg", feedbackKey: "bot:6", debug: { eventIndex: 6, turnIndex: 2 } },
      ]
    );

    // Only index 6 should be published (index 3 <= floor of 5)
    expect(received).toHaveLength(1);
    expect((received[0] as { feedbackKey: string }).feedbackKey).toBe("bot:6");
  });

  it("does not advance cursor to a lower value", async () => {
    const bus = await freshBus();
    bus.setCommittedCursorFloor("sender-1", 10);
    bus.setCommittedCursorFloor("sender-1", 5); // should be ignored
    const received: unknown[] = [];
    bus.addSubscriberForSender("sender-1", (p) => received.push(p));

    bus.publishCommittedHistoryItems("sender-1", [
      { role: "assistant", text: "msg", feedbackKey: "bot:8", debug: { eventIndex: 8, turnIndex: 1 } },
      { role: "assistant", text: "msg", feedbackKey: "bot:11", debug: { eventIndex: 11, turnIndex: 2 } },
    ]);

    expect(received).toHaveLength(1);
    expect((received[0] as { feedbackKey: string }).feedbackKey).toBe("bot:11");
  });
});

describe("publishCommittedHistoryItems", () => {
  it("returns the number of published items", async () => {
    const bus = await freshBus();
    const count = bus.publishCommittedHistoryItems("sender-1", [
      { role: "assistant", text: "one", feedbackKey: "bot:0", debug: { eventIndex: 0, turnIndex: 1 } },
      { role: "assistant", text: "two", feedbackKey: "bot:1", debug: { eventIndex: 1, turnIndex: 2 } },
    ]);
    expect(count).toBe(2);
  });

  it("skips items without text or custom payload", async () => {
    const bus = await freshBus();
    const received: unknown[] = [];
    bus.addSubscriberForSender("sender-1", (p) => received.push(p));

    bus.publishCommittedHistoryItems("sender-1", [
      // no text, no custom — should be skipped
      { role: "assistant", debug: { eventIndex: 0, turnIndex: 1 } } as never,
    ]);

    expect(received).toHaveLength(0);
  });

  it("respects minEventIndexExclusive option", async () => {
    const bus = await freshBus();
    const received: unknown[] = [];
    bus.addSubscriberForSender("sender-1", (p) => received.push(p));

    bus.publishCommittedHistoryItems(
      "sender-1",
      [
        { role: "assistant", text: "old", feedbackKey: "bot:2", debug: { eventIndex: 2, turnIndex: 1 } },
        { role: "assistant", text: "new", feedbackKey: "bot:5", debug: { eventIndex: 5, turnIndex: 2 } },
      ],
      { minEventIndexExclusive: 3 }
    );

    expect(received).toHaveLength(1);
    expect((received[0] as { feedbackKey: string }).feedbackKey).toBe("bot:5");
  });

  it("propagates debug.source and traceId into published payload", async () => {
    const bus = await freshBus();
    const received: unknown[] = [];
    bus.addSubscriberForSender("sender-1", (p) => received.push(p));

    bus.publishCommittedHistoryItems(
      "sender-1",
      [{ role: "assistant", text: "msg", feedbackKey: "bot:0", debug: { eventIndex: 0, turnIndex: 1 } }],
      { source: "rasa-webhook", traceId: "trace-abc" }
    );

    const payload = received[0] as Record<string, unknown>;
    expect((payload.debug as Record<string, unknown>).source).toBe("rasa-webhook");
    expect((payload.debug as Record<string, unknown>).traceId).toBe("trace-abc");
  });
});
