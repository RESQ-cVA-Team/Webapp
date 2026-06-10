"use client";
import React from "react";
import { useThread } from "@/components/ThreadContext";

type ThreadListResponse = {
  results?: Array<{ id: number; name?: string }>;
};

export function ThreadName() {
    const { currentThreadId } = useThread();
    
    const getCurrentThreadName = React.useCallback(async () => {
      if (!currentThreadId) return "No Thread Selected";
      try {
        const res = await fetch(`/api/threads`);
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            return "No Thread Selected";
          }
          throw new Error("Failed to fetch thread name");
        }
        const data = (await res.json()) as ThreadListResponse;
        const thread = (data.results || []).find((t) => t.id === currentThreadId);
        return thread?.name || "Unnamed Thread";
      } catch (e) {
        console.error("Error fetching thread name:", e);
        return "Error Loading Thread Name";
      }
    }, [currentThreadId]);
    
    const [name, setName] = React.useState("Loading...");
  React.useEffect(() => {
      getCurrentThreadName().then(setName);
    }, [getCurrentThreadName]);

  return (
    <span className="font-bold text-white truncate min-w-0">{name}</span>
  );
}