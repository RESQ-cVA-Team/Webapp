'use client'

import { useEffect, useRef } from "react";
import MessageFeedbackControls from "@/components/feedback/message-feedback-controls";
import { ScrollArea } from "@/components/ui/scroll-area";
import ChatBubble from "@/components/ui/chat-bubble";

type Message = {
  id: string;
  sender: "user" | "other";
  content: string;
  kind?: "normal" | "progress";
  feedbackKey?: string;
  feedback?: {
    submitted: boolean;
    rating: "up" | "down";
    issues?: string[];
    detailText?: string | null;
  } | null;
  buttons?: Array<{
    title: string;
    payload: string;
  }>;
};

type Props = {
  messages: Message[];
  currentThreadId: number | null;
  onButtonClick?: (payload: string, title?: string) => void;
};

export default function ChatMessageList({ messages, currentThreadId, onButtonClick }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const latestNonProgressMessageIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.kind !== "progress")
    .at(-1)?.index;
  const latestAssistantMessageIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.sender === "other" && message.kind !== "progress" && !!message.feedbackKey)
    .at(-1)?.index;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="relative flex-1  h-0 min-w-0">
      <ScrollArea className="h-full w-full ">
        <div className="flex flex-col gap-2 p-2 pt-10">
          {messages.map((msg, index) => {
            const shouldShowButtons = msg.sender === "other" && latestNonProgressMessageIndex === index;
            const shouldShowFeedback =
              currentThreadId != null &&
              msg.sender === "other" &&
              msg.kind !== "progress" &&
              !!msg.feedbackKey &&
              latestAssistantMessageIndex === index;

            return (
              <div key={msg.id} className="group/message flex flex-col">
                <ChatBubble
                  message={msg.content}
                  sender={msg.sender === "user" ? "me" : "other"}
                  isProgress={msg.kind === "progress"}
                  buttons={shouldShowButtons ? msg.buttons : undefined}
                  onButtonClick={onButtonClick}
                />

                {shouldShowFeedback && msg.feedbackKey ? (
                  <MessageFeedbackControls
                    threadId={currentThreadId}
                    messageKey={msg.feedbackKey}
                    messageText={msg.content}
                    initialFeedback={msg.feedback ?? null}

            />
                ) : null}
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
