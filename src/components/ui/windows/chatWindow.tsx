"use client"

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatInput } from "@/components/ui/chat-input";
import ChatMessageList from "@/components/ui/chat-message-list";
import { useChatStore } from "@/store/useChatStore";
import {
  isVisualizationPlanMessageDTO,
  isVisualizationResponseDTO,
  resolveVisualizationTraceId,
  type VisualizationPlanMessageDTO,
} from "@/models/dto/response";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { WaveAsset } from "../assets/wave-asset";
import { Skeleton } from "@/components/ui/skeleton";
import { useThread } from "@/components/ThreadContext";
import { ThreadName } from "../thread-name";
import InfoAlertWindow from "./infoAlertWindow";

type Message = {
  id: string;
  sender: "user" | "other";
  content: string;
  kind?: "normal" | "progress" | "plan";
  feedbackKey?: string;
  feedback?: {
    submitted: boolean;
    rating: "up" | "down";
    issues?: string[];
    detailText?: string | null;
  } | null;
  debug?: {
    pending?: boolean;
    eventIndex?: number;
    turnIndex?: number;
    timestamp?: number;
    source?: string;
    intentName?: string;
    intentConfidence?: number;
    entities?: unknown[];
    actionName?: string;
    policyName?: string;
    policyConfidence?: number;
  };
    buttons?: Array<{
    title: string;
    payload: string;
  }>;
};

type HistoryResponseItem = {
  role?: unknown;
  text?: unknown;
  custom?: unknown;
  buttons?: unknown;
  feedbackKey?: unknown;
  feedback?: unknown;
  debug?: unknown;
};

type FeedbackPayload = {
  submitted: boolean;
  rating: "up" | "down";
  issues?: string[];
  detailText?: string | null;
};

type HistoryApiResponse = {
  history?: unknown;
  error?: string;
  status?: number;
};

const PLAN_CHAT_DEBUG_MODE = process.env.NODE_ENV === "development";
const SEEN_SSE_EVENT_TTL_MS = 15000;


function createPlanDebugKey(plan: VisualizationPlanMessageDTO, traceId: string | null): string | null {
  if (traceId) {
    return `trace:${traceId}`;
  }

  try {
    return `plan:${JSON.stringify(plan.plan)}`;
  } catch {
    return null;
  }
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
    .join(",")}}`;
}

function createMessageKey(message: Message): string {
  return stableSerialize({
    sender: message.sender,
    kind: message.kind ?? "normal",
    content: message.content,
    feedbackKey: message.feedbackKey ?? null,
    buttons: message.buttons ?? null,
  });
}

function createMessageCrossSourceKey(message: Message): string {
  return stableSerialize({
    sender: message.sender,
    kind: message.kind ?? "normal",
    content: message.content,
    buttons: message.buttons ?? null,
  });
}

function mergeMessages(historyMessages: Message[], liveMessages: Message[]): Message[] {
  const merged = [...historyMessages];
  const seen = new Set(historyMessages.map((message) => createMessageKey(message)));
  const seenCrossSource = new Set(
    historyMessages.map((message) => createMessageCrossSourceKey(message))
  );

  for (const message of liveMessages) {
    const key = createMessageKey(message);
    const crossSourceKey = createMessageCrossSourceKey(message);
    if (seen.has(key) || seenCrossSource.has(crossSourceKey)) continue;
    seen.add(key);
    seenCrossSource.add(crossSourceKey);
    merged.push(message);
  }

  return merged;
}

function getCustomProgressText(custom: unknown): string | null {
  if (!custom || typeof custom !== "object") {
    return null;
  }

  const progress = (custom as { progress?: unknown }).progress;
  return typeof progress === "string" ? progress : null;
}

function isMessageButton(value: unknown): value is { title: string; payload: string } {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { title?: unknown }).title === "string" &&
    typeof (value as { payload?: unknown }).payload === "string"
  );
}

function formatPlanDebugMessage(plan: VisualizationPlanMessageDTO, traceId: string | null): string {
  const normalizedPlan: VisualizationPlanMessageDTO = {
    ...plan,
    ...(traceId && !plan.trace_id ? { trace_id: traceId } : {}),
  };

  let payload = "";
  try {
    payload = JSON.stringify(normalizedPlan, null, 2);
  } catch {
    payload = "{\n  \"error\": \"Failed to serialize visualization plan payload\"\n}";
  }

  return ["[dev] Visualization plan payload", payload].join("\n");
}

function createPlanDebugEntry(
  plan: VisualizationPlanMessageDTO,
  traceId: string | null,
  seenPlanKeys: Set<string>
): Message | null {
  if (!PLAN_CHAT_DEBUG_MODE) {
    return null;
  }

  const planKey = createPlanDebugKey(plan, traceId);
  if (!planKey || seenPlanKeys.has(planKey)) {
    return null;
  }

  seenPlanKeys.add(planKey);

  return {
    id: crypto.randomUUID(),
    sender: "other",
    kind: "plan",
    content: formatPlanDebugMessage(plan, traceId),
    debug: {
      source: "visualization-plan",
    },
  };
}

function mapHistoryItems(items: unknown[], seenPlanKeys: Set<string>): { mapped: Message[]; customPayloads: unknown[] } {
  const customPayloads: unknown[] = [];
  const mapped = items.flatMap((item): Message[] => {
    const candidate = item as HistoryResponseItem;
    if (!candidate || (candidate.role !== "user" && candidate.role !== "assistant")) return [];

    const messages: Message[] = [];

    if (candidate.custom && typeof candidate.custom === "object") {
      customPayloads.push(candidate.custom);

      if (candidate.role === "assistant" && isVisualizationPlanMessageDTO(candidate.custom)) {
        const traceId = resolveVisualizationTraceId(candidate.custom);
        const planMessage = createPlanDebugEntry(candidate.custom, traceId, seenPlanKeys);
        if (planMessage) {
          messages.push(planMessage);
        }
      }
    }

    if (typeof candidate.text !== "string") return messages;

    messages.unshift({
      id: crypto.randomUUID(),
      sender: candidate.role === "user" ? "user" : "other",
      content: candidate.text,
      buttons: Array.isArray(candidate.buttons)
        ? candidate.buttons.filter(isMessageButton).map((button) => ({
            title: button.title,
            payload: button.payload,
          }))
        : undefined,
      feedbackKey: typeof candidate.feedbackKey === "string" ? candidate.feedbackKey : undefined,
      feedback:
        candidate.feedback && typeof candidate.feedback === "object"
          ? (candidate.feedback as FeedbackPayload)
          : undefined,
      debug: candidate.debug && typeof candidate.debug === "object" ? candidate.debug as Message["debug"] : undefined,
    });

    return messages;
  });

  return { mapped, customPayloads };
}

async function fetchThreadHistory(threadId: number, seenPlanKeys: Set<string>): Promise<{
  mapped: Message[];
  customPayloads: unknown[];
  error: string | null;
  status: number | null;
}> {
  const res = await fetch(`/api/rasa/history?threadId=${threadId}`, {
    credentials: "include",
    cache: "no-store",
  });

  let data: HistoryApiResponse | null = null;
  try {
    data = (await res.json()) as HistoryApiResponse;
  } catch {
    data = null;
  }

  if (!res.ok) {
    return {
      mapped: [],
      customPayloads: [],
      error: data?.error ?? `History request failed (${res.status})`,
      status: data?.status ?? res.status,
    };
  }

  const { mapped, customPayloads } = mapHistoryItems(Array.isArray(data?.history) ? data.history : [], seenPlanKeys);

  return {
    mapped,
    customPayloads,
    error: typeof data?.error === "string" ? data.error : null,
    status: typeof data?.status === "number" ? data.status : res.status,
  };
}


export default function ChatWindow() {
  const { currentThreadId } = useThread();
  const [messages, setMessages] = useState<Message[]>([]);
  const [autocompleteItems, setAutocompleteItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [isWaitingForBot, setIsWaitingForBot] = useState(false);
  const seenPlanMessageKeysRef = useRef<Set<string>>(new Set());
  const seenIncomingEventIdsRef = useRef<Map<string, number>>(new Map());
  const language = useSettingsStore((s) => s.language);
  const { t } = useTranslation('common');
  const isChatDisabled = currentThreadId === null;
  const lastUserMessageRef = useRef<string>("");
  const lastErrorHadRetryRef = useRef<boolean>(false);

  const emitPlanDebugMessage = useCallback((plan: VisualizationPlanMessageDTO, traceId: string | null) => {
    const planMessage = createPlanDebugEntry(plan, traceId, seenPlanMessageKeysRef.current);
    if (!planMessage) {
      return;
    }

    setMessages((prev) => [...prev, planMessage]);
  }, []);

  const applyVisualizationFromCustom = useCallback((custom: unknown, options?: { emitPlanMessage?: boolean }) => {
     const { setVisualization, addToHistory, setSelectedChartIndex, setSelectedStatisticsIndex, rememberVisualizationPlan } = useChatStore.getState();

    if (isVisualizationPlanMessageDTO(custom)) {
      const traceId = resolveVisualizationTraceId(custom);
      if (traceId) {
        rememberVisualizationPlan(traceId, custom);
      }
      if (options?.emitPlanMessage !== false) {
        emitPlanDebugMessage(custom, traceId);
      }
      return;
    }

    if (isVisualizationResponseDTO(custom)) {
      setVisualization(custom);
      addToHistory(custom);
      const chartCount = custom.charts?.length ?? 0;
      const statCount = custom.stats?.length ?? 0;

      if (chartCount > 0) {
        setSelectedStatisticsIndex(null);
        setSelectedChartIndex(0);
      } else if (statCount > 0) {
        setSelectedChartIndex(null);
        setSelectedStatisticsIndex(0);
      } else {
        setSelectedChartIndex(null);
        setSelectedStatisticsIndex(null);
      }
    }
  }, [emitPlanDebugMessage]);

  const addMessage = useCallback((payload: unknown, eventId?: string) => {
  const obj = payload as {
    text?: unknown;
    custom?: unknown;
    type?: unknown;
    buttons?: unknown;
    progress?: unknown;
    feedbackKey?: unknown;
    feedback?: unknown;
    debug?: unknown;
  } | null;

  if (!obj || typeof obj !== "object") return;

  if (obj.type === "connected") return;

  if (obj.type === "lock") {
    setIsWaitingForBot(true);
    return;
  }

  if (obj.type === "release") {
    setMessages((prev) => prev.filter((message) => message.kind !== "progress"));
    setIsWaitingForBot(false);
    return;
  }

  if (eventId) {
    const now = Date.now();

    for (const [key, timestamp] of seenIncomingEventIdsRef.current.entries()) {
      if (now - timestamp > SEEN_SSE_EVENT_TTL_MS) {
        seenIncomingEventIdsRef.current.delete(key);
      }
    }

    const previousSeenAt = seenIncomingEventIdsRef.current.get(eventId);
    if (typeof previousSeenAt === "number" && now - previousSeenAt <= SEEN_SSE_EVENT_TTL_MS) {
      return;
    }

    seenIncomingEventIdsRef.current.set(eventId, now);
  }

  const progressText =
    typeof obj.progress === "string"
      ? obj.progress
      : getCustomProgressText(obj.custom);

  if (progressText) {
    setMessages((prev) => {
      const base = prev.filter((m) => m.kind !== "progress");
      return [
        ...base,
        {
          id: crypto.randomUUID(),
          sender: "other",
          content: progressText,
          kind: "progress",
        },
      ];
    });

    return;
  }

  setMessages((prev) => prev.filter((m) => m.kind !== "progress"));

  if (typeof obj.text === "string" && obj.text.length > 0) {
    const botMsg: Message = {
      id: crypto.randomUUID(),
      sender: "other",
      content: obj.text,
    };

    if (lastErrorHadRetryRef.current) {
      botMsg.buttons = [{
        title: "Try again",
        payload: lastUserMessageRef.current,
      }];
      lastErrorHadRetryRef.current = false;
    }

    if (Array.isArray(obj.buttons)) {
      const buttons = obj.buttons
        .filter(isMessageButton)
        .map((btn) => ({
          title: btn.title,
          payload: btn.payload,
        }));

      if (buttons.length > 0) {
        botMsg.buttons = buttons;
      }
    }

    setMessages((prev) => [...prev, botMsg]);
  }

  if (obj.custom) {
    setMessages((prev) => prev.filter((m) => m.kind !== "progress"));
    const custom = obj.custom as { type?: string; retry?: boolean };
    lastErrorHadRetryRef.current = custom?.type === "visualization_error" && custom?.retry === true;
    applyVisualizationFromCustom(obj.custom);
  }
 
}, [applyVisualizationFromCustom]);

  const handleButtonClick = async (buttonPayload: string) => {
    // Send a formatted message with the button payload
    await sendMessage(buttonPayload);
  };

  useEffect(() => {
    seenPlanMessageKeysRef.current.clear();
    seenIncomingEventIdsRef.current.clear();

    let cancelled = false;

    if (!currentThreadId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const threadId = currentThreadId;
    setMessages([]);

    async function fetchMessages() {
      setLoading(true);
      try {
        const { mapped, customPayloads, error, status } = await fetchThreadHistory(threadId, seenPlanMessageKeysRef.current);

        if (!cancelled) {
          setIsWaitingForBot(false);
          if (error && status !== 404) {
            console.warn("History request degraded:", error);
          }

          setMessages((prev) => mergeMessages(mapped, prev));
          for (const customPayload of customPayloads) {
            applyVisualizationFromCustom(customPayload, { emitPlanMessage: false });
          }
        }
      } catch (err) {
        console.error("Failed to fetch thread history", err);
        if (!cancelled) {
          setMessages([]);
        }
      } finally {
        if (!cancelled) {
          setTimeout(() => setLoading(false), 150);
        }
      }
    }

    fetchMessages();

    return () => {
      cancelled = true;
    };
  }, [applyVisualizationFromCustom, currentThreadId]);

  useEffect(() => {
    if (!currentThreadId) return;

    let closedByCleanup = false;
    const es = new EventSource(`/api/rasa/stream?threadId=${currentThreadId}`, { withCredentials: true });

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data ?? "null");
        addMessage(data, event.lastEventId || undefined);
      } catch (err) {
        console.error("SSE message parse error:", err);
      }
    };

    es.onerror = (err) => {
      if (closedByCleanup || es.readyState === EventSource.CLOSED) {
        return;
      }
      console.warn("SSE connection interrupted; browser will retry.", err);
    };

    return () => {
      closedByCleanup = true;
      es.close();
    };
  }, [addMessage, currentThreadId]);

  useEffect(() => {
    fetch(`/api/autocomplete?language=${language}`)
      .then((res) => res.json())
      .then((data: unknown) => {
        if (!Array.isArray(data)) {
          return;
        }

        setAutocompleteItems(
          data.filter((value): value is string => typeof value === "string")
        );
      })
      .catch((err) => console.error("Failed to fetch autocomplete values:", err));
  }, [language]);

  const sendMessage = async (msg: string) => {
  if (!currentThreadId) return;
  lastUserMessageRef.current = msg;

  window.dispatchEvent(
    new CustomEvent("thread-activity", {
      detail: { threadId: currentThreadId },
    })
  );

  const userMsg: Message = {
    id: crypto.randomUUID(),
    sender: "user",
    content: msg,
    debug: {
      pending: true,
      source: "live-input",
    },
  };

  setMessages((prev) => [...prev, userMsg]);

  try {
    const res = await fetch("/api/rasa", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": language,
      },
      body: JSON.stringify({ message: msg, threadId: currentThreadId }),
      credentials: "include",
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

  } catch (err) {
    setIsWaitingForBot(false);

    console.error( "/api/rasa error:", err);

    const errorMsg: Message = {
      id: crypto.randomUUID(),
      sender: "other",
      content: t("chat.error"),
      debug: {
        pending: true,
        source: "live-error",
      },
    };

    setMessages((prev) => [...prev, errorMsg]);
  }
};

  return (
    <div className=" flex flex-col h-full">
      <div className="gap-0 bg-transparent relative min-h-0 flex-none"  >  
        <div className="w-[101%] h-15 rounded-t-xl z-10 flex items-center justify-between px-10 pr-4 bg-gradient-to-tl from-secondary to-primary">
          <div className="flex h-full min-h-0 w-full items-center justify-between gap-2">
            <ThreadName />
            <InfoAlertWindow />
          </div>
        </div>
        <WaveAsset className=" absolute w-full max-h-15 min-h-10 fill-gradient-to-r from-primary to-accent align-self bg-transparent z-1 p-0 pointer-events-none" />
      </div>
      <div className=" p-4 flex-1 pt-0 flex flex-col h-full min-h-0 w-full">
        {loading ? (
          <div className="flex-1 flex flex-col gap-3 h-full w-full">
            <div className="flex flex-col h-full gap-2 w-full">
              <Skeleton className="h-6 max-w-[60%] mt-10 bg-muted" />
              <Skeleton className="h-6 max-w-[70%] bg-muted" />
              <Skeleton className="h-6 max-w-[70%] bg-muted" />
              <Skeleton className="h-6 max-w-[50%] bg-muted" />
              <Skeleton className="h-6 max-w-[60%] mt-10 bg-muted" />
              <Skeleton className="h-6 max-w-[70%] bg-muted" />
              <Skeleton className="h-6 max-w-[50%] bg-muted" />
            </div>
          </div>
         ) : (
          <ChatMessageList messages={messages} currentThreadId={currentThreadId} onButtonClick={handleButtonClick} />
        )}
        <ChatInput
          onSubmit={sendMessage}
          loading={isWaitingForBot}
          disabled={isChatDisabled}
          autocompleteItems={autocompleteItems}
          placeholder={isChatDisabled ? t('chat.disabledPlaceholder') : t('chat.placeholder')}
        />
      </div>
    </div>
  );
}
