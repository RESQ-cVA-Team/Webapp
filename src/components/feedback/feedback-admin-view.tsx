"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageSquareText, RefreshCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const FEEDBACK_DEBUG_MODE = process.env.NODE_ENV === "development";
const DETAIL_MIN_WIDTH = 448;
const DETAIL_MAX_WIDTH_PADDING = 64;

type IssueOption = {
  id: string;
  label: string;
};

type HistoryDebug = {
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

type ConversationHistoryMessage = {
  role: string;
  text?: string;
  custom?: Record<string, unknown> | null;
  debug?: HistoryDebug;
};

type FeedbackRecord = {
  id: string;
  userId: string;
  userEmail?: string | null;
  userName?: string | null;
  threadId: number;
  threadName?: string | null;
  messageKey: string;
  messageText: string;
  rating: "up" | "down";
  issues: string[];
  detailText?: string | null;
  includeConversationContext: boolean;
  conversationContext?: {
    history?: ConversationHistoryMessage[];
  } | null;
  submissionContext?: Record<string, unknown> | null;
  serviceSnapshots: Array<{
    service: string;
    version?: string | null;
    commitSha?: string | null;
    imageTag?: string | null;
    modelName?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
  createdAt: string;
  updatedAt: string;
};

type AdminResponse = {
  total: number;
  results: FeedbackRecord[];
};

type Props = {
  issueOptions: IssueOption[];
  storageMode?: "local-file" | "postgres";
  storageDescription?: string;
  storageWarning?: string | null;
};

type ThreadGroup = {
  key: string;
  threadId: number;
  threadName: string;
  latestCreatedAt: string;
  totalReports: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
  records: FeedbackRecord[];
};

function formatTimestamp(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function readSnapshotMetadataValue(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[]
): string | null {
  if (!metadata) {
    return null;
  }

  for (const key of keys) {
    const candidate = metadata[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function buildThreadGroups(records: FeedbackRecord[]): ThreadGroup[] {
  const groups = new Map<string, ThreadGroup>();

  for (const record of records) {
    const key = `${record.threadId}:${record.threadName ?? ""}`;
    const existing = groups.get(key);

    if (existing) {
      existing.records.push(record);
      existing.totalReports += 1;
      if (record.rating === "down") {
        existing.thumbsDownCount += 1;
      } else {
        existing.thumbsUpCount += 1;
      }
      if (new Date(record.createdAt).getTime() > new Date(existing.latestCreatedAt).getTime()) {
        existing.latestCreatedAt = record.createdAt;
      }
      continue;
    }

    groups.set(key, {
      key,
      threadId: record.threadId,
      threadName: record.threadName ?? `Thread ${record.threadId}`,
      latestCreatedAt: record.createdAt,
      totalReports: 1,
      thumbsUpCount: record.rating === "up" ? 1 : 0,
      thumbsDownCount: record.rating === "down" ? 1 : 0,
      records: [record],
    });
  }

  return [...groups.values()].sort(
    (left, right) => new Date(right.latestCreatedAt).getTime() - new Date(left.latestCreatedAt).getTime()
  );
}

function formatDebugLines(debug?: HistoryDebug): string[] {
  const debugLines: string[] = [];
  if (!debug) {
    return debugLines;
  }

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

  return debugLines;
}

function renderCollapsedPayload(label: string, payload: Record<string, unknown>) {
  return (
    <details className="rounded border bg-muted/40 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{label}</summary>
      <pre className="mt-3 overflow-x-auto rounded bg-muted p-3 text-xs">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </details>
  );
}

function renderConversationMessage(message: ConversationHistoryMessage) {
  if (typeof message.text === "string" && message.text.trim()) {
    return <p className="whitespace-pre-wrap">{message.text}</p>;
  }

  const custom = message.custom && typeof message.custom === "object" ? message.custom : null;
  const progressText = custom && typeof custom.progress === "string" ? custom.progress : null;

  if (progressText) {
    const restPayload = { ...custom };
    delete restPayload.progress;

    return (
      <div className="flex flex-col gap-2">
        <Badge variant="secondary" className="w-fit">Progress update</Badge>
        <p className="whitespace-pre-wrap">{progressText}</p>
        {Object.keys(restPayload).length > 0 ? renderCollapsedPayload("Show progress payload", restPayload) : null}
      </div>
    );
  }

  if (custom) {
    return (
      <div className="flex flex-col gap-2">
        <Badge variant="outline" className="w-fit">Custom payload</Badge>
        {renderCollapsedPayload("Show payload", custom)}
      </div>
    );
  }

  return <p className="text-muted-foreground">[non-text payload]</p>;
}

export default function FeedbackAdminView({
  issueOptions,
  storageMode,
  storageDescription,
  storageWarning,
}: Props) {
  const [ratingFilter, setRatingFilter] = useState<string>("all");
  const [issueFilter, setIssueFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<FeedbackRecord | null>(null);
  const [detailWidth, setDetailWidth] = useState(960);
  const isResizingRef = useRef(false);

  const issueLabelById = useMemo(
    () => new Map(issueOptions.map((option) => [option.id, option.label])),
    [issueOptions]
  );

  const threadGroups = useMemo(() => buildThreadGroups(records), [records]);

  const loadFeedback = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (ratingFilter !== "all") {
      params.set("rating", ratingFilter);
    }
    if (issueFilter !== "all") {
      params.set("issue", issueFilter);
    }
    if (query.trim()) {
      params.set("query", query.trim());
    }

    try {
      const response = await fetch(`/api/admin/feedback?${params.toString()}`, {
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => null)) as AdminResponse | { message?: string } | null;

      if (!response.ok) {
        throw new Error(
          payload && "message" in payload && payload.message
            ? payload.message
            : `Failed to load feedback (${response.status})`
        );
      }

      const data = payload as AdminResponse;
      setRecords(data.results);
      setTotal(data.total);
      setSelectedRecord((current) => data.results.find((item) => item.id === current?.id) ?? null);
    } catch (loadError) {
      console.error(loadError);
      setError(loadError instanceof Error ? loadError.message : "Failed to load feedback");
      setRecords([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [issueFilter, query, ratingFilter]);

  useEffect(() => {
    void loadFeedback();
  }, [loadFeedback]);

  useEffect(() => {
    if (!selectedRecord || typeof window === "undefined") {
      return;
    }

    const nextWidth = Math.min(960, window.innerWidth - DETAIL_MAX_WIDTH_PADDING);
    setDetailWidth(Math.max(DETAIL_MIN_WIDTH, nextWidth));
  }, [selectedRecord]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function clampWidth(clientX: number) {
      const maxWidth = Math.max(DETAIL_MIN_WIDTH, window.innerWidth - DETAIL_MAX_WIDTH_PADDING);
      const nextWidth = window.innerWidth - clientX;
      return Math.min(maxWidth, Math.max(DETAIL_MIN_WIDTH, nextWidth));
    }

    function handleMouseMove(event: MouseEvent) {
      if (!isResizingRef.current) {
        return;
      }

      setDetailWidth(clampWidth(event.clientX));
    }

    function stopResizing() {
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    function handleWindowResize() {
      setDetailWidth((current) => clampWidth(window.innerWidth - current));
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResizing);
    window.addEventListener("mouseleave", stopResizing);
    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResizing);
      window.removeEventListener("mouseleave", stopResizing);
      window.removeEventListener("resize", handleWindowResize);
      stopResizing();
    };
  }, []);

  const startResizing = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Feedback review</h1>
        <p className="text-sm text-muted-foreground">
          Review message-level feedback together with conversation context and service-version snapshots.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <div className="min-w-52 flex-1">
          <label className="mb-2 block text-sm font-medium">Search</label>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search message text, comment, or thread"
          />
        </div>

        <div className="min-w-40">
          <label className="mb-2 block text-sm font-medium">Rating</label>
          <Select value={ratingFilter} onValueChange={setRatingFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All ratings" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ratings</SelectItem>
              <SelectItem value="up">Thumbs up</SelectItem>
              <SelectItem value="down">Thumbs down</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-52">
          <label className="mb-2 block text-sm font-medium">Issue</label>
          <Select value={issueFilter} onValueChange={setIssueFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All issues" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All issues</SelectItem>
              {issueOptions.map((issue) => (
                <SelectItem key={issue.id} value={issue.id}>
                  {issue.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button type="button" variant="outline" onClick={() => void loadFeedback()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
          Refresh
        </Button>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} feedback record(s)</span>
        <span>Showing newest first</span>
      </div>

      {error ? (
        <Alert variant="destructive">
          <MessageSquareText className="size-4" />
          <AlertTitle>Failed to load feedback</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {storageWarning ? (
        <Alert>
          <MessageSquareText className="size-4" />
          <AlertTitle>Feedback Storage</AlertTitle>
          <AlertDescription>
            {storageWarning}
            {storageDescription ? ` Active backend: ${storageMode} (${storageDescription}).` : ""}
          </AlertDescription>
        </Alert>
      ) : null}

      {threadGroups.length > 0 ? (
        <div className="grid gap-4">
          {threadGroups.map((group) => (
            <section key={group.key} className="rounded-lg border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">{group.threadName}</h2>
                    <Badge variant="outline">Thread {group.threadId}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Latest report {formatTimestamp(group.latestCreatedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">{group.totalReports} reports</Badge>
                  <Badge variant="secondary">{group.thumbsUpCount} up</Badge>
                  <Badge variant="destructive">{group.thumbsDownCount} down</Badge>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Issues</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.records.map((record) => (
                    <TableRow
                      key={record.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedRecord(record)}
                    >
                      <TableCell>{formatTimestamp(record.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant={record.rating === "down" ? "destructive" : "secondary"}>
                          {record.rating === "down" ? "Down" : "Up"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-72 flex-wrap gap-1">
                          {record.issues.length > 0 ? record.issues.map((issue) => (
                            <Badge key={issue} variant="outline">
                              {issueLabelById.get(issue) ?? issue}
                            </Badge>
                          )) : <span className="text-muted-foreground">None</span>}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-md truncate">{record.messageText}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          ))}
        </div>
      ) : null}

      {!loading && records.length === 0 ? (
        <div className="rounded-lg border py-10 text-center text-muted-foreground">
          No feedback records match the current filters.
        </div>
      ) : null}

      <Sheet open={!!selectedRecord} onOpenChange={(open) => !open && setSelectedRecord(null)}>
        <SheetContent
          side="right"
          className="max-w-[96vw] min-w-[28rem] overflow-hidden sm:max-w-none"
          style={{ width: `${detailWidth}px` }}
        >
          {selectedRecord ? (
            <>
              <div
                aria-label="Resize feedback detail"
                role="separator"
                aria-orientation="vertical"
                className="absolute inset-y-0 left-0 z-20 flex w-4 -translate-x-1/2 cursor-col-resize items-center justify-center"
                onMouseDown={startResizing}
              >
                <div className="h-full w-px bg-border transition-colors hover:bg-foreground/40" />
              </div>
              <SheetHeader>
                <SheetTitle>Feedback detail</SheetTitle>
                <SheetDescription>
                  Submitted {formatTimestamp(selectedRecord.createdAt)} in {selectedRecord.threadName ?? `Thread ${selectedRecord.threadId}`}
                </SheetDescription>
              </SheetHeader>

              <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
                <div className="flex flex-col gap-6">
                <section className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={selectedRecord.rating === "down" ? "destructive" : "secondary"}>
                      {selectedRecord.rating === "down" ? "Thumbs down" : "Thumbs up"}
                    </Badge>
                    <Badge variant="outline">{selectedRecord.threadName ?? `Thread ${selectedRecord.threadId}`}</Badge>
                    <Badge variant="outline">{selectedRecord.messageKey}</Badge>
                  </div>
                  <div>
                    <h2 className="text-sm font-medium">Assistant message</h2>
                    <p className="whitespace-pre-wrap rounded-md border p-3 text-sm">{selectedRecord.messageText}</p>
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium">Issues</h2>
                  <div className="flex flex-wrap gap-2">
                    {selectedRecord.issues.length > 0 ? selectedRecord.issues.map((issue) => (
                      <Badge key={issue} variant="outline">
                        {issueLabelById.get(issue) ?? issue}
                      </Badge>
                    )) : <span className="text-sm text-muted-foreground">No issue tags</span>}
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium">Comment</h2>
                  <p className="rounded-md border p-3 text-sm whitespace-pre-wrap">
                    {selectedRecord.detailText?.trim() ? selectedRecord.detailText : "No additional detail provided."}
                  </p>
                </section>

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium">Service snapshots</h2>
                  <div className="grid gap-3">
                    {selectedRecord.serviceSnapshots.map((snapshot) => (
                      <div key={`${selectedRecord.id}-${snapshot.service}`} className="rounded-md border p-3">
                        {(() => {
                          const buildDate = readSnapshotMetadataValue(snapshot.metadata, ["buildDate"]);
                          const llmProvider = readSnapshotMetadataValue(snapshot.metadata, ["llmProvider"]);
                          const promptVersion = readSnapshotMetadataValue(snapshot.metadata, ["promptVersion"]);
                          const ssotVersion = readSnapshotMetadataValue(snapshot.metadata, ["ssotVersion"]);

                          return (
                            <>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{snapshot.service}</Badge>
                          {snapshot.version ? <Badge variant="outline">{snapshot.version}</Badge> : null}
                          {snapshot.commitSha ? <Badge variant="outline">{snapshot.commitSha}</Badge> : null}
                          {snapshot.imageTag ? <Badge variant="outline">{snapshot.imageTag}</Badge> : null}
                          {snapshot.modelName ? <Badge variant="outline">{snapshot.modelName}</Badge> : null}
                          {llmProvider ? <Badge variant="outline">{llmProvider}</Badge> : null}
                          {promptVersion ? <Badge variant="outline">prompt {promptVersion}</Badge> : null}
                          {ssotVersion ? <Badge variant="outline">ssot {ssotVersion}</Badge> : null}
                        </div>
                        {buildDate ? (
                          <p className="mt-3 text-xs text-muted-foreground">
                            Built {formatTimestamp(buildDate)}
                          </p>
                        ) : null}
                        {snapshot.metadata ? (
                          <pre className="mt-3 overflow-x-auto rounded bg-muted p-3 text-xs">
                            {JSON.stringify(snapshot.metadata, null, 2)}
                          </pre>
                        ) : null}
                            </>
                          );
                        })()}
                      </div>
                    ))}
                    {selectedRecord.serviceSnapshots.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No service metadata was captured for this submission.</p>
                    ) : null}
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium">Conversation context</h2>
                  {selectedRecord.conversationContext && Array.isArray(selectedRecord.conversationContext.history) ? (
                    <TooltipProvider>
                      <div className="grid gap-2">
                        {selectedRecord.conversationContext.history.map((message, index) => {
                          const debugLines = formatDebugLines(message.debug);

                          const content = (
                            <div key={`${selectedRecord.id}-ctx-${index}`} className="rounded-md border p-3 text-sm">
                              <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                                <span>{message.role}</span>
                                {FEEDBACK_DEBUG_MODE && debugLines.length > 0 ? (
                                  <Badge variant="outline" className="normal-case">Debug on hover</Badge>
                                ) : null}
                              </div>
                              {renderConversationMessage(message)}
                            </div>
                          );

                          if (!FEEDBACK_DEBUG_MODE || debugLines.length === 0) {
                            return content;
                          }

                          return (
                            <Tooltip key={`${selectedRecord.id}-ctx-tooltip-${index}`}>
                              <TooltipTrigger asChild>
                                {content}
                              </TooltipTrigger>
                              <TooltipContent side="left" sideOffset={8} className="max-w-[28rem] whitespace-pre-wrap break-words">
                                {debugLines.join("\n")}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </TooltipProvider>
                  ) : (
                    <p className="text-sm text-muted-foreground">No conversation snapshot was stored.</p>
                  )}
                </section>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}