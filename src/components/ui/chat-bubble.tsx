import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const CHAT_DEBUG_MODE = process.env.NODE_ENV === "development";

interface ChatBubbleProps {
  message: string;
  sender: "me" | "other";
  isTyping?: boolean;
  isProgress?: boolean;
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
  onButtonClick?: (payload: string) => void;
}

export default function ChatBubble({
  message,
  sender,
  isTyping = false,
  isProgress = false,
  debug,
  buttons,
  onButtonClick,
}: ChatBubbleProps) {
  const isMe = sender === "me";

  const debugLines: string[] = [];
  if (debug) {
    if (debug.pending) debugLines.push("pending: tracker metadata not hydrated yet");
    if (typeof debug.turnIndex === "number") debugLines.push(`turn: ${debug.turnIndex}`);
    if (typeof debug.eventIndex === "number") debugLines.push(`event: ${debug.eventIndex}`);
    if (debug.intentName) debugLines.push(`intent: ${debug.intentName}`);
    if (typeof debug.intentConfidence === "number") debugLines.push(`intent_conf: ${debug.intentConfidence.toFixed(3)}`);
    if (debug.actionName) debugLines.push(`action: ${debug.actionName}`);
    if (debug.policyName) debugLines.push(`policy: ${debug.policyName}`);
    if (typeof debug.policyConfidence === "number") debugLines.push(`policy_conf: ${debug.policyConfidence.toFixed(3)}`);
    if (debug.source) debugLines.push(`source: ${debug.source}`);
    if (Array.isArray(debug.entities) && debug.entities.length > 0) {
      debugLines.push(`entities: ${JSON.stringify(debug.entities)}`);
    }
  }

  const bubble = (
    <div
      className={cn(
        "w-fit max-w-[90%] px-4 py-2 shadow-md overflow-x-hidden",
        isMe
          ? "bg-gradient-to-r from-primary to-accent text-primary-foreground rounded-3xl rounded-br-none"
          : isProgress
            ? "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-50 rounded-2xl rounded-bl-none"
            : "bg-muted rounded-3xl rounded-bl-none"
      )}
    >
      {isTyping ? (
        <div className="flex space-x-1">
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
        </div>
      ) : (
        <p className="max-w-fit text-sm whitespace-pre-wrap break-words hyphens-auto" style={{ overflowWrap: "anywhere" }}>{message}</p>
      )}
        {buttons && buttons.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {buttons.map((btn, idx) => (
              <button
                key={idx}
                onClick={() => onButtonClick?.(btn.payload)}
                className="px-3 py-1 text-xs font-medium rounded-full border border-current opacity-80 hover:opacity-100 transition-opacity"
              >
                {btn.title}
              </button>
            ))}
          </div>
        )}
    </div>
  );

  return (
    <div className={cn("flex gap-2 items-end px-1 w-auto", isMe ? "justify-end" : "justify-start")}>      
      {CHAT_DEBUG_MODE ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {bubble}
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8} className="max-w-[28rem] whitespace-pre-wrap break-words">
              {debugLines.length > 0 ? debugLines.join("\n") : "No debug metadata on this message yet"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        bubble
      )}
    </div>
  );
}
