"use client"

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatInput } from "@/components/ui/chat-input";
import ChatMessageList from "@/components/ui/chat-message-list";
import { useChatStore } from "@/store/useChatStore";
import {
  isVisualizationPlanMessageDTO,
  isVisualizationResponseDTO,
  resolveVisualizationTraceId,
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
  rawContent?: string;
  kind?: "normal" | "progress";
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
  rawText?: unknown;
  custom?: unknown;
  buttons?: unknown;
  feedbackKey?: unknown;
  feedback?: unknown;
  debug?: unknown;
  type?: unknown;
  jobId?: unknown;
  scope?: unknown;
  source?: unknown;
  progress?: unknown;
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

function mapHistoryItems(items: unknown[]): { mapped: Message[]; customPayloads: unknown[] } {
  const customPayloads: unknown[] = [];
  const mapped = items.flatMap((item): Message[] => {
    const candidate = item as HistoryResponseItem;
    if (!candidate || (candidate.role !== "user" && candidate.role !== "assistant")) return [];

    const messages: Message[] = [];

    if (candidate.custom && typeof candidate.custom === "object") {
      customPayloads.push(candidate.custom);
    }

    const normalizedButtons = Array.isArray(candidate.buttons)
      ? candidate.buttons.filter(isMessageButton).map((button) => ({
          title: button.title,
          payload: button.payload,
        }))
      : undefined;

    if (typeof candidate.text !== "string") return messages;

    const displayText = candidate.text;
    const rawText = typeof candidate.rawText === "string" ? candidate.rawText : displayText;

    messages.unshift({
      id: crypto.randomUUID(),
      sender: candidate.role === "user" ? "user" : "other",
      content: displayText,
      rawContent: rawText,
      buttons: normalizedButtons,
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

async function fetchThreadHistory(threadId: number): Promise<{
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

  const { mapped, customPayloads } = mapHistoryItems(Array.isArray(data?.history) ? data.history : []);

  return {
    mapped,
    customPayloads,
    error: typeof data?.error === "string" ? data.error : null,
    status: typeof data?.status === "number" ? data.status : res.status,
  };
}

const LONG_ACTION_LOCK_TTL_MS = 3 * 60 * 1000;


export default function ChatWindow() {
  const { currentThreadId } = useThread();
  const [messages, setMessages] = useState<Message[]>([]);
  const [autocompleteItems, setAutocompleteItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [activeLongActionJobCount, setActiveLongActionJobCount] = useState(0);
  const activeLongActionJobsRef = useRef<Set<string>>(new Set());
  const activeLongActionLockTimersRef = useRef<Map<string, number>>(new Map());
  const seenCommittedEventIndexesRef = useRef<Set<number>>(new Set());
  const language = useSettingsStore((s) => s.language);
  const { t } = useTranslation('common');
  const isChatDisabled = currentThreadId === null;
  const isWaitingForBot = pendingRequests > 0 || activeLongActionJobCount > 0;

  const applyVisualizationFromCustom = useCallback((custom: unknown) => {
     const { setVisualization, addToHistory, setSelectedChartIndex, setSelectedStatisticsIndex, rememberVisualizationPlan } = useChatStore.getState();

    if (isVisualizationPlanMessageDTO(custom)) {
      const traceId = resolveVisualizationTraceId(custom);
      if (traceId) {
        rememberVisualizationPlan(traceId, custom);
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
  }, []);

  const addMessage = useCallback((payload: unknown) => {
    const obj = payload as HistoryResponseItem | null;

    if (!obj || typeof obj !== "object") return;

    if (obj.type === "connected") return;

    if (obj.type === "lock") {
      const jobId = typeof obj.jobId === "string" && obj.jobId.trim().length > 0 ? obj.jobId.trim() : "default";
      if (!activeLongActionJobsRef.current.has(jobId)) {
        activeLongActionJobsRef.current.add(jobId);
        setActiveLongActionJobCount(activeLongActionJobsRef.current.size);
      }

      const existingTimer = activeLongActionLockTimersRef.current.get(jobId);
      if (typeof existingTimer === "number") {
        window.clearTimeout(existingTimer);
      }

      const watchdogId = window.setTimeout(() => {
        activeLongActionJobsRef.current.delete(jobId);
        activeLongActionLockTimersRef.current.delete(jobId);
        setActiveLongActionJobCount(activeLongActionJobsRef.current.size);
        setMessages((prev) => prev.filter((message) => message.kind !== "progress"));
      }, LONG_ACTION_LOCK_TTL_MS);
      activeLongActionLockTimersRef.current.set(jobId, watchdogId);
      return;
    }

    if (obj.type === "release") {
      const jobId = typeof obj.jobId === "string" && obj.jobId.trim().length > 0 ? obj.jobId.trim() : "default";
      const timerId = activeLongActionLockTimersRef.current.get(jobId);
      if (typeof timerId === "number") {
        window.clearTimeout(timerId);
      }
      activeLongActionLockTimersRef.current.delete(jobId);
      activeLongActionJobsRef.current.delete(jobId);
      setActiveLongActionJobCount(activeLongActionJobsRef.current.size);
      setMessages((prev) => prev.filter((message) => message.kind !== "progress"));
      return;
    }

    const debug = obj.debug && typeof obj.debug === "object"
      ? (obj.debug as Message["debug"])
      : undefined;
    const eventIndex = typeof debug?.eventIndex === "number" ? debug.eventIndex : null;
    if (eventIndex !== null) {
      if (seenCommittedEventIndexesRef.current.has(eventIndex)) {
        return;
      }
      seenCommittedEventIndexesRef.current.add(eventIndex);
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

    const sender: Message["sender"] = obj.role === "user" ? "user" : "other";
    const displayText = typeof obj.text === "string" ? obj.text : null;
    const rawText =
      typeof obj.rawText === "string"
        ? obj.rawText
        : typeof obj.text === "string"
          ? obj.text
          : null;

    const normalizedButtons = Array.isArray(obj.buttons)
      ? obj.buttons
          .filter(isMessageButton)
          .map((btn) => ({
            title: btn.title,
            payload: btn.payload,
          }))
      : undefined;

    if (typeof displayText === "string" && displayText.length > 0 && (obj.role === "assistant" || obj.role === "user")) {
      const streamedMsg: Message = {
        id: crypto.randomUUID(),
        sender,
        content: displayText,
        rawContent: rawText ?? displayText,
        feedbackKey: typeof obj.feedbackKey === "string" ? obj.feedbackKey : undefined,
        feedback:
          obj.feedback && typeof obj.feedback === "object"
            ? (obj.feedback as FeedbackPayload)
            : undefined,
        debug,
      };

      if (normalizedButtons && normalizedButtons.length > 0) {
        streamedMsg.buttons = normalizedButtons;
      }

      setMessages((prev) => {
        const withoutPendingProgress = prev.filter((m) => m.kind !== "progress");

        if (obj.role !== "user") {
          return [...withoutPendingProgress, streamedMsg];
        }

        const pendingIndex = withoutPendingProgress.findIndex(
          (message) =>
            message.sender === "user" &&
            message.debug?.pending === true &&
            (message.rawContent ?? message.content) === (rawText ?? displayText)
        );

        if (pendingIndex === -1) {
          return [...withoutPendingProgress, streamedMsg];
        }

        const next = [...withoutPendingProgress];
        next.splice(pendingIndex, 1, streamedMsg);
        return next;
      });
    }

    if (obj.custom) {
      setMessages((prev) => prev.filter((m) => m.kind !== "progress"));
      applyVisualizationFromCustom(obj.custom);
    }
  }, [applyVisualizationFromCustom]);

  const handleButtonClick = async (buttonPayload: string, buttonTitle?: string) => {
    await sendMessage(buttonPayload, { uiDisplayText: buttonTitle });
  };

  useEffect(() => {
    seenCommittedEventIndexesRef.current.clear();
    activeLongActionJobsRef.current.clear();
    for (const timerId of activeLongActionLockTimersRef.current.values()) {
      window.clearTimeout(timerId);
    }
    activeLongActionLockTimersRef.current.clear();
    setActiveLongActionJobCount(0);
    setPendingRequests(0);

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
        const { mapped, customPayloads, error, status } = await fetchThreadHistory(threadId);

        if (!cancelled) {
          if (error && status !== 404) {
            console.warn("History request degraded:", error);
          }

          for (const message of mapped) {
            const eventIndex = message.debug?.eventIndex;
            if (typeof eventIndex === "number") {
              seenCommittedEventIndexesRef.current.add(eventIndex);
            }
          }

          setMessages(mapped);
          for (const customPayload of customPayloads) {
            applyVisualizationFromCustom(customPayload);
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
        addMessage(data);
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

  const sendMessage = async (msg: string, options?: { uiDisplayText?: string }) => {
    if (!currentThreadId) return;

    const pendingDisplayText =
      typeof options?.uiDisplayText === "string" && options.uiDisplayText.trim().length > 0
        ? options.uiDisplayText
        : msg;
    const pendingMessage: Message = {
      id: crypto.randomUUID(),
      sender: "user",
      content: pendingDisplayText,
      rawContent: msg,
      debug: {
        pending: true,
        source: "local-pending",
      },
    };

    setMessages((prev) => [...prev, pendingMessage]);
    setPendingRequests((count) => count + 1);

    window.dispatchEvent(
      new CustomEvent("thread-activity", {
        detail: { threadId: currentThreadId },
      })
    );

    try {
      const res = await fetch("/api/rasa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": language,
        },
        body: JSON.stringify({
          message: msg,
          threadId: currentThreadId,
          ...(pendingDisplayText !== msg ? { uiDisplayText: pendingDisplayText } : {}),
        }),
        credentials: "include",
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

    } catch (err) {
      console.error( "/api/rasa error:", err);

      setMessages((prev) =>
        prev.filter(
          (message) =>
            !(message.sender === "user" && message.debug?.pending === true && (message.rawContent ?? message.content) === msg)
        )
      );

      const errorMsg: Message = {
        id: crypto.randomUUID(),
        sender: "other",
        content: t("chat.error"),
      };

      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setPendingRequests((count) => Math.max(0, count - 1));
    }
  };

  return (
    <div className=" flex flex-col h-full">
      <div className="gap-0 bg-transparent relative min-h-0 flex-none"  >  
        <div className="w-full h-15 rounded-t-xl z-10 flex items-center justify-between px-10 pr-4 bg-gradient-to-tl from-secondary to-primary">
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
