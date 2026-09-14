"use client";

import { useEffect, useState } from "react";
import { getInteractionLogConfigCached } from "@/lib/interactionLogConfigClient";

const DISMISS_KEY = "interaction-log-notice-dismissed-session";

/** Persistent-but-dismissible-per-session, not a one-time toast -- logging
 * is an ongoing state for the current user, so the disclosure should read
 * that way rather than implying a one-off event. Re-shown each new
 * browser session (sessionStorage, not localStorage). */
export default function InteractionLogNoticeBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getInteractionLogConfigCached()
      .then((data) => {
        if (cancelled) return;
        if (!data.noticeForCurrentUser) return;
        try {
          if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
        } catch {
          // sessionStorage unavailable -- fail open, still show the notice.
        }
        setVisible(true);
      })
      .catch(() => {
        if (!cancelled) setVisible(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Ignore -- worst case the banner reappears next render.
    }
    setVisible(false);
  }

  return (
    <div className="relative z-20 flex items-center justify-between gap-4 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <span>Your conversations in this app are currently being logged for product testing.</span>
      <button type="button" onClick={dismiss} className="shrink-0 underline">
        Dismiss
      </button>
    </div>
  );
}
