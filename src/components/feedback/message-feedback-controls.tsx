"use client";

import { useEffect, useState } from "react";
import { ThumbsDown, ThumbsUp, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getFeedbackConfigCached, type FeedbackConfigResponse } from "@/lib/feedbackConfigClient";

type ExistingFeedback = {
  submitted: boolean;
  rating: "up" | "down";
  issues?: string[];
  detailText?: string | null;
};

type SubmitFeedbackResponse = {
  alreadySubmitted: boolean;
  wasUpdated?: boolean;
  feedback: {
    rating: "up" | "down";
    issues: string[];
    detailText?: string | null;
  };
};

type Props = {
  threadId: number;
  messageKey: string;
  messageText: string;
  initialFeedback?: ExistingFeedback | null;
};

export default function MessageFeedbackControls({
  threadId,
  messageKey,
  messageText,
  initialFeedback = null,
}: Props) {
  const [config, setConfig] = useState<FeedbackConfigResponse | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingRating, setPendingRating] = useState<"up" | "down" | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<string[]>(initialFeedback?.issues ?? []);
  const [detailText, setDetailText] = useState(initialFeedback?.detailText ?? "");
  const [submittedFeedback, setSubmittedFeedback] = useState<ExistingFeedback | null>(initialFeedback);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
        const payload = await getFeedbackConfigCached();
        if (!cancelled) {
          setConfig(payload);
        }
      } catch (error) {
        console.error("Failed to load feedback config", error);
      } finally {
        if (!cancelled) {
          setLoadingConfig(false);
        }
      }
    }

    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  function toggleIssue(issueId: string) {
    setSelectedIssues((current) =>
      current.includes(issueId)
        ? current.filter((value) => value !== issueId)
        : [...current, issueId]
    );
  }

  function handleThumbSelection(rating: "up" | "down") {
    setPendingRating(rating);

    if (rating === "down") {
      if (submittedFeedback?.rating !== "down") {
        setSelectedIssues([]);
        setDetailText("");
      }
      setSheetOpen(true);
      return;
    }

    setSheetOpen(false);
  }

  function handleCancelPending() {
    setPendingRating(null);
    setSheetOpen(false);

    if (submittedFeedback?.rating === "down") {
      setSelectedIssues(submittedFeedback.issues ?? []);
      setDetailText(submittedFeedback.detailText ?? "");
      return;
    }

    setSelectedIssues([]);
    setDetailText("");
  }

  async function submitFeedback(payload: { rating: "up" | "down"; issues: string[]; detailText?: string }) {
    setSubmitting(true);

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          threadId,
          messageKey,
          messageText,
          rating: payload.rating,
          issues: payload.issues,
          detailText: payload.detailText ?? "",
        }),
      });

      const result = (await response.json().catch(() => null)) as SubmitFeedbackResponse | { message?: string } | null;
      if (!response.ok) {
        throw new Error(result && "message" in result && result.message ? result.message : "Failed to submit feedback");
      }

      if (result && "feedback" in result) {
        setSubmittedFeedback({
          submitted: true,
          rating: result.feedback.rating,
          issues: result.feedback.issues,
          detailText: result.feedback.detailText ?? "",
        });
      }

      handleCancelPending();
      toast(response.status === 201 ? "Feedback received" : "Feedback updated");
    } catch (error) {
      console.error("Feedback submission failed", error);
      toast(error instanceof Error ? error.message : "Failed to submit feedback");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingConfig || !config?.enabled) {
    return null;
  }

  const commentLimit = config.commentMaxLength;
  const effectiveRating = pendingRating ?? submittedFeedback?.rating ?? null;
  const shouldKeepVisible = pendingRating !== null || sheetOpen;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-2 pl-3 pt-1">
        <div className={`flex items-center gap-1.5 transition-opacity ${shouldKeepVisible ? "opacity-100" : "opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100"}`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={effectiveRating === "up" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 px-2"
                disabled={submitting}
                onClick={() => handleThumbSelection("up")}
                aria-label="Good response"
              >
                <ThumbsUp className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Good response</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={effectiveRating === "down" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 px-2"
                disabled={submitting}
                onClick={() => handleThumbSelection("down")}
                aria-label="Bad response"
              >
                <ThumbsDown className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Bad response</TooltipContent>
          </Tooltip>

        </div>

        {pendingRating === "up" ? (
          <Alert className="max-w-md">
            <TriangleAlert className="size-4" />
            <AlertTitle>Send positive feedback</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>{config.disclosure}</span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={submitting}
                  onClick={() => void submitFeedback({ rating: "up", issues: [] })}
                >
                  Accept
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={handleCancelPending}>
                  Cancel
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        <Sheet open={sheetOpen} onOpenChange={(open) => open ? setSheetOpen(true) : handleCancelPending()}>
          <SheetContent side="right" className="w-full max-w-xl overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Bad response</SheetTitle>
              <SheetDescription>
                Help admins understand what went wrong with this assistant message.
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-5 px-4 pb-4">
              <Alert>
                <TriangleAlert className="size-4" />
                <AlertTitle>Conversation context is included</AlertTitle>
                <AlertDescription>
                  {config.disclosure}
                </AlertDescription>
              </Alert>

              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">What was the main problem?</p>
                <div className="grid gap-3">
                  {config.issues.map((issue) => (
                    <label key={issue.id} className="flex items-center gap-3 text-sm">
                      <Checkbox
                        checked={selectedIssues.includes(issue.id)}
                        onCheckedChange={() => toggleIssue(issue.id)}
                      />
                      <span>{issue.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor={`feedback-detail-${messageKey}`}>
                  Optional details
                </label>
                <Textarea
                  id={`feedback-detail-${messageKey}`}
                  value={detailText}
                  maxLength={commentLimit}
                  onChange={(event) => setDetailText(event.target.value)}
                  placeholder="Share any extra detail that would help with review."
                />
                <p className="text-right text-xs text-muted-foreground">
                  {detailText.length}/{commentLimit}
                </p>
              </div>
            </div>

            <SheetFooter>
              <Button type="button" variant="outline" onClick={handleCancelPending} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={submitting || selectedIssues.length === 0}
                onClick={() => void submitFeedback({ rating: "down", issues: selectedIssues, detailText })}
              >
                Accept
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}