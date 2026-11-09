"use client"
import { createContext, useContext, useState } from "react";

type ThreadContextType = {
  currentThreadId: number | null;
  setCurrentThreadId: (id: number | null) => void;
  threadsResolved: boolean;
  setThreadsResolved: (resolved: boolean) => void;
};

const ThreadContext = createContext<ThreadContextType | undefined>(undefined);

export const ThreadProvider = ({ children }: { children: React.ReactNode }) => {
  const [currentThreadId, setCurrentThreadId] = useState<number | null>(null);
  const [threadsResolved, setThreadsResolved] = useState(false);

  return (
    <ThreadContext.Provider value={{ currentThreadId, setCurrentThreadId, threadsResolved, setThreadsResolved }}>
      {children}
    </ThreadContext.Provider>
  );
};

export const useThread = () => {
  const context = useContext(ThreadContext);
  if (!context) throw new Error("useThread must be used within ThreadProvider");
  return context;
};