import { getRasaUrlForRequest, withRasaAuth } from "@/lib/rasaConfig";
import { buildRasaSenderId } from "@/lib/rasaSender";

export type RasaHistoryEvent = {
  event: string;
  text?: string;
  parse_data?: {
    text?: string;
    intent?: { name?: string; confidence?: number };
    entities?: unknown[];
  };
  custom?: Record<string, unknown>;
  data?: { custom?: Record<string, unknown> };
  timestamp?: number;
  metadata?: Record<string, unknown>;
  policy?: string;
  confidence?: number;
  name?: string;
  buttons?: unknown;
};

export type RasaHistoryButton = {
  title: string;
  payload: string;
};

export type RasaHistoryDebug = {
  eventIndex: number;
  turnIndex: number;
  timestamp?: number;
  source?: string;
  intentName?: string;
  intentConfidence?: number;
  entities?: unknown[];
  actionName?: string;
  policyName?: string;
  policyConfidence?: number;
};

export type RasaHistoryItem = {
  role: "user" | "assistant";
  text?: string;
  rawText?: string;
  custom?: Record<string, unknown>;
  buttons?: RasaHistoryButton[];
  feedbackKey?: string;
  debug?: RasaHistoryDebug;
};

export function normalizeButtons(input: unknown): RasaHistoryButton[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const buttons = input
    .filter(
      (button): button is { title: string; payload: string } =>
        !!button &&
        typeof button === "object" &&
        typeof (button as { title?: unknown }).title === "string" &&
        typeof (button as { payload?: unknown }).payload === "string"
    )
    .map((button) => ({
      title: button.title,
      payload: button.payload,
    }));

  return buttons.length > 0 ? buttons : undefined;
}

export async function fetchRasaTrackerEvents(apiUrl: string, senderId: string) {
  const tracker = await fetch(withRasaAuth(`${apiUrl}/conversations/${senderId}/tracker`), {
    cache: "no-store",
  });
  const contentType = tracker.headers.get("content-type") || "";

  if (!tracker.ok) {
    return {
      events: [] as RasaHistoryEvent[],
      error: "Rasa tracker endpoint is unavailable",
      status: tracker.status,
    };
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    return {
      events: [] as RasaHistoryEvent[],
      error: "Rasa tracker returned non-JSON response",
      status: tracker.status,
    };
  }

  let data: { events?: unknown };
  try {
    data = await tracker.json();
  } catch {
    return {
      events: [] as RasaHistoryEvent[],
      error: "Failed to parse Rasa tracker response",
      status: tracker.status,
    };
  }

  return {
    events: Array.isArray(data.events) ? (data.events as RasaHistoryEvent[]) : [],
    error: undefined,
    status: tracker.status,
  };
}

export function mapRasaTrackerEvents(events: RasaHistoryEvent[], includeDebugMetadata = false) {
  let turnIndex = 0;

  return events.flatMap((event, eventIndex): RasaHistoryItem[] => {
    const previousActionName =
      eventIndex > 0 && events[eventIndex - 1]?.event === "action"
        ? events[eventIndex - 1]?.name
        : undefined;

    if (event.event === "user") {
      const rawText = typeof event.text === "string" ? event.text : event.parse_data?.text;
      if (!rawText) return [];
      const uiDisplayText =
        typeof event.metadata?.ui_display_text === "string"
          ? event.metadata.ui_display_text
          : typeof event.metadata?.uiDisplayText === "string"
            ? event.metadata.uiDisplayText
            : null;
      const text = uiDisplayText && uiDisplayText.trim().length > 0 ? uiDisplayText : rawText;
      turnIndex += 1;

      return [
        {
          role: "user",
          text,
          rawText,
          ...(includeDebugMetadata
            ? {
                debug: {
                  eventIndex,
                  turnIndex,
                  timestamp: event.timestamp,
                  source: typeof event.metadata?.source === "string" ? event.metadata.source : undefined,
                  intentName: event.parse_data?.intent?.name,
                  intentConfidence: event.parse_data?.intent?.confidence,
                  entities: Array.isArray(event.parse_data?.entities) ? event.parse_data?.entities : undefined,
                },
              }
            : {}),
        },
      ];
    }

    if (event.event !== "bot") {
      return [];
    }

    const custom =
      event.custom && typeof event.custom === "object"
        ? event.custom
        : event.data?.custom && typeof event.data.custom === "object"
          ? event.data.custom
          : null;
    const buttons = normalizeButtons(
      event.buttons ?? (event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>).buttons : undefined)
    );

    const debug = includeDebugMetadata
      ? {
          eventIndex,
          turnIndex,
          timestamp: event.timestamp,
          source: typeof event.metadata?.source === "string" ? event.metadata.source : undefined,
          actionName: previousActionName,
          policyName: event.policy,
          policyConfidence: event.confidence,
        }
      : undefined;

    if (typeof event.text === "string" && custom) {
      return [
        {
          role: "assistant",
          text: event.text,
          custom,
          buttons,
          feedbackKey: `bot:${eventIndex}`,
          ...(debug ? { debug } : {}),
        },
      ];
    }

    if (typeof event.text === "string") {
      return [
        {
          role: "assistant",
          text: event.text,
          buttons,
          feedbackKey: `bot:${eventIndex}`,
          ...(debug ? { debug } : {}),
        },
      ];
    }

    if (!custom) {
      return [];
    }

    return [
      {
        role: "assistant",
        custom,
        buttons,
        feedbackKey: `bot:${eventIndex}`,
        ...(debug ? { debug } : {}),
      },
    ];
  });
}

export async function fetchRasaHistory(params: {
  headers: Headers;
  cookies: Map<string, string>;
  userSub: string;
  threadId: number | null;
  includeDebugMetadata?: boolean;
}) {
  const apiUrl = getRasaUrlForRequest(params.headers, params.cookies);
  if (!apiUrl) {
    return {
      history: [] as RasaHistoryItem[],
      error: "Rasa not configured",
      status: 500,
    };
  }

  const senderId = buildRasaSenderId(params.userSub, params.threadId);
  const trackerResult = await fetchRasaTrackerEvents(apiUrl, senderId);
  if (trackerResult.error) {
    return {
      history: [] as RasaHistoryItem[],
      error: trackerResult.error,
      status: trackerResult.status,
    };
  }

  const history = mapRasaTrackerEvents(trackerResult.events, params.includeDebugMetadata === true);

  return {
    history,
    error: undefined,
    status: trackerResult.status,
  };
}