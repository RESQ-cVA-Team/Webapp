import { describe, expect, it } from "vitest";
import { publishCommittedHistoryItems, setCommittedCursorFloor } from "@/lib/sseBus";
import type { RasaHistoryItem } from "@/lib/rasaHistory";

describe("sseBus committed cursor", () => {
  it("publishes only events above the cursor floor", () => {
    const senderId = `sender-${crypto.randomUUID()}`;

    const committed: RasaHistoryItem[] = [
      { role: "assistant", text: "older", debug: { eventIndex: 5, turnIndex: 2 } },
      { role: "assistant", text: "newer", debug: { eventIndex: 6, turnIndex: 2 } },
    ];

    setCommittedCursorFloor(senderId, 5);

    const published = publishCommittedHistoryItems(senderId, committed, {
      minEventIndexExclusive: 5,
      source: "test",
      traceId: "trace-1",
    });

    expect(published).toBe(1);
  });

  it("keeps cursor monotonic and prevents republishing the same committed event", () => {
    const senderId = `sender-${crypto.randomUUID()}`;

    const firstPass: RasaHistoryItem[] = [
      { role: "assistant", text: "once", debug: { eventIndex: 9, turnIndex: 3 } },
    ];

    const secondPass: RasaHistoryItem[] = [
      { role: "assistant", text: "once", debug: { eventIndex: 9, turnIndex: 3 } },
      { role: "assistant", text: "twice", debug: { eventIndex: 10, turnIndex: 3 } },
    ];

    const firstPublished = publishCommittedHistoryItems(senderId, firstPass, {
      minEventIndexExclusive: -1,
      source: "test",
    });

    const secondPublished = publishCommittedHistoryItems(senderId, secondPass, {
      minEventIndexExclusive: -1,
      source: "test",
    });

    expect(firstPublished).toBe(1);
    expect(secondPublished).toBe(1);
  });
});
