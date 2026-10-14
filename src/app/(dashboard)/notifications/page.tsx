"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Notification } from "@/types";
import {
  Bell,
  Check,
  CheckCheck,
  Eye,
  EyeOff,
  Inbox,
  Loader2,
  Trash2,
  UserPlus,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Icon per notification type
const TYPE_ICON: Record<Notification["type"], typeof Bell> = {
  conversation_assigned: UserPlus,
};

type FilterTab = "all" | "unread";

export default function NotificationsPage() {
  const router = useRouter();
  const { accountId } = useAuth();
  const [notifications, setNotifications] = useState<Notification[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!accountId) return;
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const json = await res.json();
        setNotifications((json.notifications ?? []) as Notification[]);
        return;
      }
    } catch {
      // Fallback to client query if route was unreachable
    }

    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("notifications")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (fetchErr) {
      setError(fetchErr.message);
      return;
    }
    setNotifications((data ?? []) as Notification[]);
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("notifications-page-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as Notification;
            setNotifications((prev) => {
              if (!prev) return [row];
              if (prev.some((n) => n.id === row.id)) return prev;
              return [row, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as Notification;
            setNotifications((prev) =>
              prev?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ??
              prev,
            );
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Notification>;
            setNotifications(
              (prev) => prev?.filter((n) => n.id !== oldRow.id) ?? prev,
            );
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Mark single notification read or unread
  const toggleRead = useCallback(
    async (id: string, currentlyRead: boolean) => {
      const willBeRead = !currentlyRead;
      const readAt = willBeRead ? new Date().toISOString() : undefined;

      // Optimistic update
      setNotifications(
        (prev) =>
          prev?.map((n) => (n.id === id ? { ...n, read_at: readAt } : n)) ??
          prev,
      );

      try {
        const res = await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, read: willBeRead }),
        });

        if (!res.ok) {
          throw new Error("Failed to update status");
        }
        toast.success(willBeRead ? "Marked as read" : "Marked as unread");
      } catch {
        toast.error("Failed to update notification");
        load();
      }
    },
    [load],
  );

  // Delete single notification
  const deleteNotification = useCallback(
    async (id: string) => {
      setDeletingIds((prev) => ({ ...prev, [id]: true }));

      // Optimistic delete
      setNotifications((prev) => prev?.filter((n) => n.id !== id) ?? prev);

      try {
        const res = await fetch(`/api/notifications?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });

        if (!res.ok) {
          throw new Error("Failed to delete notification");
        }
        toast.success("Notification removed");
      } catch {
        toast.error("Failed to delete notification");
        load();
      } finally {
        setDeletingIds((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [load],
  );

  // Row click navigates to conversation (if present) and marks as read
  const handleClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) {
        toggleRead(n.id, false);
      }
      if (n.conversation_id) {
        router.push(`/inbox?c=${n.conversation_id}`);
      }
    },
    [toggleRead, router],
  );

  const unreadCount =
    notifications?.filter((n) => !n.read_at).length ?? 0;
  const totalCount = notifications?.length ?? 0;

  // Mark all as read
  const markAllRead = useCallback(async () => {
    if (unreadCount === 0) return;
    setMarkingAll(true);
    const now = new Date().toISOString();

    // Optimistic update
    setNotifications(
      (prev) =>
        prev?.map((n) => (n.read_at ? n : { ...n, read_at: now })) ?? prev,
    );

    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });

      if (!res.ok) {
        throw new Error("Failed to mark all as read");
      }
      toast.success("All notifications marked as read");
    } catch {
      toast.error("Failed to mark all as read");
      load();
    } finally {
      setMarkingAll(false);
    }
  }, [unreadCount, load]);

  // Delete all notifications
  const deleteAllNotifications = useCallback(async () => {
    if (totalCount === 0) return;
    setDeletingAll(true);
    setConfirmDeleteAllOpen(false);

    // Optimistic clear
    setNotifications([]);

    try {
      const res = await fetch("/api/notifications?all=true", {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Failed to clear notifications");
      }
      toast.success("All notifications deleted");
    } catch {
      toast.error("Failed to delete notifications");
      load();
    } finally {
      setDeletingAll(false);
    }
  }, [totalCount, load]);

  const filteredNotifications =
    notifications?.filter((n) => {
      if (filterTab === "unread") return !n.read_at;
      return true;
    }) ?? [];

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm font-medium text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  if (notifications === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1920px] mx-auto space-y-6">
      {/* Header bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Conversations and inquiries assigned to you appear here in real time.
          </p>
        </div>

        {/* Global actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={unreadCount === 0 || markingAll}
            onClick={markAllRead}
            className="h-9 gap-1.5 text-xs font-semibold"
          >
            {markingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCheck className="h-3.5 w-3.5 text-[#008069]" />
            )}
            Mark all read
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={totalCount === 0 || deletingAll}
            onClick={() => setConfirmDeleteAllOpen(true)}
            className="h-9 gap-1.5 text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 hover:border-red-500/30"
          >
            {deletingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Delete all
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setFilterTab("all")}
          className={cn(
            "px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors",
            filterTab === "all"
              ? "bg-[#008069] text-white shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          All ({totalCount})
        </button>
        <button
          type="button"
          onClick={() => setFilterTab("unread")}
          className={cn(
            "px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5",
            filterTab === "unread"
              ? "bg-[#008069] text-white shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          Unread
          {unreadCount > 0 && (
            <span
              className={cn(
                "px-1.5 py-0.2 text-[10px] font-bold rounded-full",
                filterTab === "unread"
                  ? "bg-white text-[#008069]"
                  : "bg-primary/20 text-primary",
              )}
            >
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Notifications list */}
      {filteredNotifications.length === 0 ? (
        <div className="flex h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-muted/20 p-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-3">
            <Inbox className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-foreground">
            {filterTab === "unread"
              ? "No unread notifications"
              : "No notifications yet"}
          </p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            {filterTab === "unread"
              ? "You have addressed all assigned conversations and inquiries."
              : "New assignments and alerts from teammates will be displayed here."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filteredNotifications.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Bell;
            const isUnread = !n.read_at;
            const isDeleting = !!deletingIds[n.id];

            return (
              <li
                key={n.id}
                className={cn(
                  "group relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-4 transition-all",
                  isUnread
                    ? "border-primary/40 bg-primary/[0.04] hover:border-primary/60 hover:bg-primary/[0.07]"
                    : "border-border/70 bg-card hover:border-border hover:bg-muted/30",
                  isDeleting && "opacity-50 pointer-events-none",
                )}
              >
                {/* Main clickable area */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleClick(n)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleClick(n);
                    }
                  }}
                  className="flex flex-1 items-start gap-3.5 text-left cursor-pointer min-w-0"
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                      isUnread
                        ? "bg-[#008069]/20 text-[#008069] ring-1 ring-[#008069]/40"
                        : "bg-muted text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    <Icon className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "truncate text-sm font-semibold tracking-tight",
                          isUnread ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {n.title}
                      </span>
                      {isUnread && (
                        <span
                          aria-label="Unread"
                          className="h-2 w-2 shrink-0 rounded-full bg-[#008069] shadow-[0_0_8px_rgba(0,128,105,0.8)]"
                        />
                      )}
                    </div>

                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {n.body}
                      </p>
                    )}

                    <p className="mt-1 text-[11px] font-medium text-muted-foreground/75">
                      {formatDistanceToNow(new Date(n.created_at), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </div>

                {/* Individual Row Actions */}
                <div
                  className="flex shrink-0 items-center gap-1.5 self-end sm:self-center border-t border-border/40 sm:border-0 pt-2 sm:pt-0 w-full sm:w-auto justify-end"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Toggle Read/Unread */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-8 px-2.5 text-xs gap-1.5 transition-colors",
                      isUnread
                        ? "text-[#008069] hover:bg-[#008069]/10 hover:text-[#008069]"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRead(n.id, !isUnread);
                    }}
                    title={isUnread ? "Mark as read" : "Mark as unread"}
                  >
                    {isUnread ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Mark read</span>
                      </>
                    ) : (
                      <>
                        <EyeOff className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Mark unread</span>
                      </>
                    )}
                  </Button>

                  {/* Delete Single */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNotification(n.id);
                    }}
                    title="Delete notification"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Confirmation Dialog: Delete All Notifications */}
      <Dialog
        open={confirmDeleteAllOpen}
        onOpenChange={setConfirmDeleteAllOpen}
      >
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground">
              Delete all notifications?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-2">
              This action will permanently delete all {totalCount} notifications
              associated with your account. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4 flex flex-row items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmDeleteAllOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="gap-1.5 font-semibold bg-red-600 hover:bg-red-700 text-white"
              onClick={deleteAllNotifications}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
