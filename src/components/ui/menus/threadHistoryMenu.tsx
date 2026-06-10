"use client"
import Fuse from "fuse.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SquarePen, Search, X, Pencil } from "lucide-react";
import { ArrowLeftToLine, PanelLeftIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import {AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle,AlertDialogTrigger} from "@/components/ui/alert-dialog"
import { toast } from "sonner";
import { useThread } from "@/components/ThreadContext";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";


type Thread = {
  id: number;
  name: string;
}

export function SideMenu() {
  const {
    open,
    setOpen,
  } = useSidebar();
  
  const { t } = useTranslation('common');

  const [threads, setThreads] = useState<Thread[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Thread[]>([]);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const searchResultRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const { currentThreadId, setCurrentThreadId } = useThread();

  const selectThread = useCallback((threadId: number) => {
    setCurrentThreadId(threadId);
    setSearchOpen(false);
    setSearchQuery("");
  }, [setCurrentThreadId]);
  const bootstrapThread = useCallback(async (threadId: number) => {
    try {
      const res = await fetch('/api/rasa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          threadId,
          message: 'hi',
          metadata: {
            source: 'thread-bootstrap',
            bootstrap: true,
          },
        }),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        console.error('Failed to bootstrap thread with greeting:', res.status, errorText);
      }
    } catch (error) {
      console.error('Failed to bootstrap thread with greeting:', error);
    }
  }, []);

  const deleteThread = async (id:number) => {
    try {
      const res = await fetch(`/api/threads/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || "Failed to delete thread");
      }

      toast(t("threads.delete.title"));
      const remaining = threads.filter((thread) => thread.id !== id);
      if (currentThreadId === id) {
        setCurrentThreadId(remaining[0]?.id ?? null);
      }
      await getThreads();
    } catch (error) {
      console.error("Failed to delete thread", error);
      toast("Failed to delete thread");
    }
  };

  const renameThread = async (id:number, newName:string) => {
    try {
      const res = await fetch(`/api/threads/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newName }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || "Failed to rename thread");
      }

      toast("Thread has been renamed");
      await getThreads();
    } catch (error) {
      console.error("Failed to rename thread", error);
      toast("Failed to rename thread");
    }
  };

  const postThread = useCallback(async (name: string) => {
    const res = await fetch('/api/threads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    });

    const data = await res.json();

    if (res.ok) {
      toast(`Thread ${name} has been created`)
      setThreads((prev) => [data, ...prev.filter((thread) => thread.id !== data.id)]);
      setCurrentThreadId(data.id);
      void bootstrapThread(data.id);
    } else {
      console.error('Failed to create thread:', res.status, data);
    }
  }, [bootstrapThread, setCurrentThreadId]);

  const getThreads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/threads', { method: 'GET' });

      if (!res.ok) {
        console.error('Failed to fetch threads:', res.statusText);
        return;
      }

      const data = await res.json();

      const newThreads = (data.results || []);
      if (newThreads.length === 0) {
        setThreads([]);
        setCurrentThreadId(null);
        return;
      }

      setThreads(newThreads);
      const hasCurrentThread = currentThreadId !== null && newThreads.some((thread: Thread) => thread.id === currentThreadId);
      if ((!hasCurrentThread || currentThreadId === null) && newThreads.length > 0) {
        setCurrentThreadId(newThreads[0].id);
      }
    } catch (err) {
      console.error('Error fetching threads:', err);
    } finally {
      setLoading(false);
    }
  }, [currentThreadId, setCurrentThreadId]);


  useEffect(() => {
    setOpen(true);
  }, [setOpen]);

  useEffect(() => {
    getThreads();
  }, [getThreads]);

  useEffect(() => {
    const onThreadActivity = (event: Event) => {
      const customEvent = event as CustomEvent<{ threadId?: number }>;
      const activeThreadId = customEvent.detail?.threadId;
      if (typeof activeThreadId !== "number") return;

      setThreads((prev) => {
        const index = prev.findIndex((thread) => thread.id === activeThreadId);
        if (index <= 0) return prev;
        const next = [...prev];
        const [thread] = next.splice(index, 1);
        next.unshift(thread);
        return next;
      });
    };

    window.addEventListener("thread-activity", onThreadActivity as EventListener);
    return () => {
      window.removeEventListener("thread-activity", onThreadActivity as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery("");
      setSelectedSearchIndex(0);
    }
  }, [searchOpen]);

  useEffect(() => {
    const query = searchQuery.trim();

    if (!query) {
      setSearchResults(threads);
      return;
    }

    const fuse = new Fuse(threads, {
      keys: ["name"],
      threshold: 0.35,
      ignoreLocation: true,
      minMatchCharLength: 1,
    });

    setSearchResults(fuse.search(query).map(({ item }) => item));
  }, [searchQuery, threads]);

  useEffect(() => {
    if (searchResults.length === 0) {
      setSelectedSearchIndex(0);
      return;
    }

    setSelectedSearchIndex((current) => Math.min(current, searchResults.length - 1));
  }, [searchResults]);

  useEffect(() => {
    searchResultRefs.current[selectedSearchIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedSearchIndex]);

  const handleSearchKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (searchResults.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedSearchIndex((current) => (current + 1) % searchResults.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedSearchIndex((current) => (current - 1 + searchResults.length) % searchResults.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      selectThread(searchResults[selectedSearchIndex]?.id ?? searchResults[0].id);
    }
  }, [searchResults, selectThread, selectedSearchIndex]);
  
  return (
    //Collaps/Expand Button
    <Sidebar collapsible="icon" variant="inset" className="overflow-hidden" >
      <SidebarHeader className="pt-22 pb-0">
          <SidebarMenuButton
            onClick={() => setOpen((current) => !current)}
            variant="outline"
            tooltip={open ? t('threads.menu.collapse') : t('threads.menu.expand')}
            className="w-full flex items-center justify-center hover:text-white"
          >
          <span className={open ? "ml-2" : "hidden"}>{open ? t('threads.menu.collapse') : ""}</span>
          {open ? <ArrowLeftToLine className="size-4 ml-auto" /> : <PanelLeftIcon className="size-4 ml-auto" />}
          </SidebarMenuButton> 
        <SidebarSeparator />
      </SidebarHeader>

      {/* Utility Buttons*/}
      <SidebarContent className="center-items">
        <SidebarGroup>
          <Dialog>
            <DialogTrigger asChild>

              {/* New Thread Button*/}
              <SidebarMenuButton
                variant="outline"
                tooltip={t('threads.menu.new')}
                className="w-full flex items-center justify-center md:justify-start hover:text-white"
              >
                <SquarePen className="w-4 h-4" />
                <span className="ml-2">{t('threads.menu.new')}</span>
              </SidebarMenuButton>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const input = e.currentTarget.elements.namedItem("name") as HTMLInputElement;
                  postThread(input.value);
                }}
              >
                <DialogHeader className="mb-2">
                  <DialogTitle>{t('threads.new.title')}</DialogTitle>
                  <DialogDescription>
                    {t('threads.new.description')}
                  </DialogDescription>
                </DialogHeader>
                <Field className="mb-6">
                  <Input
                    name="name"
                    defaultValue={t('threads.name.default') + (" ") + (threads.length + 1)}
                  />
                </Field>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="outline" className="hover:text-white">
                      {t('threads.dialog.cancel')}
                    </Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button type="submit">
                      {t('threads.dialog.save')}
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
            <DialogTrigger asChild>
              {/* Search Threads Button*/}
              <SidebarMenuButton
                variant="outline"
                tooltip={t('threads.menu.search')}
                className="w-full flex items-center justify-center md:justify-start hover:text-white"
              >
                <Search className="w-4 h-4" />
                <span className="ml-2">{t('threads.menu.search')}</span>
              </SidebarMenuButton>
            </DialogTrigger>
            <DialogContent
              className="flex h-[28rem] max-h-[80vh] flex-col sm:max-w-md"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (document.activeElement instanceof HTMLElement) {
                  document.activeElement.blur();
                }
              }}
            >
              <DialogHeader className="mb-2">
                <DialogTitle>{t('threads.menu.search')}</DialogTitle>
                <DialogDescription>
                  {t('threads.search.description')}
                </DialogDescription>
              </DialogHeader>
              <Field className="mb-4">
                <Input
                  autoFocus
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={t('threads.search.placeholder')}
                />
              </Field>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {searchResults.length > 0 ? (
                  searchResults.map((thread, index) => (
                    <button
                      key={thread.id}
                      type="button"
                      ref={(element) => {
                        searchResultRefs.current[index] = element;
                      }}
                      onClick={() => selectThread(thread.id)}
                      onMouseEnter={() => setSelectedSearchIndex(index)}
                      className={`w-full rounded px-3 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent hover:text-white ${selectedSearchIndex === index ? "bg-sidebar-accent text-white" : ""}`}
                    >
                      <span className="block truncate">{thread.name}</span>
                    </button>
                  ))
                ) : (
                  <Alert className="border-dashed bg-black/5">
                    <AlertTitle>{t('threads.search.empty.title')}</AlertTitle>
                    <AlertDescription className="text-xs">
                      {t('threads.search.empty.description')}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </SidebarGroup>

        {/*Conversation Threads List*/}
        <SidebarGroup className="group-data-[collapsible=icon]:hidden gap-1">
          <div className="text-sidebar-foreground/70 text-xs truncate">
            {t('threads.menu.list')}
          </div> 
          <div> 
            {loading ? (
              <div className="flex flex-col gap-1">
              
                  <Skeleton className="h-6 w-10/12 rounded-md bg-muted my-1" />

                  <Skeleton className="h-6 w-11/12 rounded-md bg-muted my-1" />
  
                  <Skeleton className="h-6 w-9/12 rounded-md bg-muted my-1" />
              </div>
              ) : threads.length === 0 ? (
                <Alert className="mt-2 border-dashed bg-black/5">
                  <AlertTitle className="">{t('threads.empty.title')}</AlertTitle>
                  <AlertDescription className="text-xs">
                    {t('threads.empty.description')}
                  </AlertDescription>
                </Alert>
            ) : (
              threads.map((thread) => (
                <SidebarMenuItem key={thread.id} >
                  <div className="relative group/item flex flex-row items-center rounded-md min-w-0 hover:bg-sidebar-accent cursor-pointer">
                    <SidebarMenuButton
                      onClick={(e) => {
                        e.stopPropagation();
                        selectThread(thread.id);
                        
                      }}
                      className=" group-hover/item:text-white hover:text-white">
                      <span className="truncate ml-2">{thread.name}</span>
                    </SidebarMenuButton>
                    <Dialog
                      open={openId === thread.id}
                      onOpenChange={(open) => setOpenId(open ? thread.id : null)}
                    >
                      <DialogTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className=" opacity-0 transition-opacity duration-75 group-hover/item:opacity-100 p-1 rounded text-white"
                        >
                          <Pencil className="w-4 h-4 hover:fill-white" />
                        </button>
                      </DialogTrigger>

                      {/* Rename Thread Button*/}
                      <DialogContent className="sm:max-w-sm">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const input = e.currentTarget.elements.namedItem("name") as HTMLInputElement;
                            renameThread(thread.id, input.value);
                            setOpenId(null);
                          }}
                        >
                          <DialogHeader className="mb-2">
                            <DialogTitle>{t('threads.rename.title')}</DialogTitle>
                            <DialogDescription>
                              {t('threads.rename.description')}
                            </DialogDescription>
                          </DialogHeader>
                          <Field className="mb-6">
                            <Input
                              name="name"
                              defaultValue={thread.name}
                            />
                          </Field>
                          <DialogFooter>
                            <DialogClose asChild>
                              <Button type="button" variant="outline" className="hover:text-white">
                                {t('threads.dialog.cancel')}
                              </Button>
                            </DialogClose>
                            <Button type="submit">
                              {t('threads.dialog.save')}
                            </Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                    
                    <div className="mx-auto flex-1"/>

                    {/* Delete Thread Button */}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          onClick={(e) => {e.stopPropagation(); }}
                          className="mr-2 opacity-0 transition-opacity duration-75 group-hover/item:opacity-100 p-1 rounded text-white hover:text-red-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            deleteThread(thread.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              deleteThread(thread.id);
                            }
                          }}
                        >
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('threads.delete.title')} {thread.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('threads.delete.description')}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="hover:text-white">{t('threads.dialog.cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                              asChild
                              variant="destructive"
                            >
                              <button type="submit" className="hover:text-shadow-2xs">{t('threads.dialog.delete') }</button>
                            </AlertDialogAction>                          
                          </AlertDialogFooter>
                        </form>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </SidebarMenuItem>
              ))
            )}
          </div>
        </SidebarGroup>          
      </SidebarContent>
    <SidebarFooter />
  </Sidebar>
  )
}