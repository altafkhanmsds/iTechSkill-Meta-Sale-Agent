"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Activity,
  AlertOctagon,
  CheckCircle2,
  Clock,
  Database,
  Loader2,
  RefreshCw,
  RotateCcw,
  Server,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface DlqItem {
  id: number;
  batch_id: string;
  phone_number_id: string;
  status: string;
  attempts: number;
  last_error?: string | null;
  last_attempt_at?: string | null;
  created_at: string;
}

interface RelayStats {
  totalRecent: number;
  acceptedCount: number;
  failedCount: number;
  lastAttemptAt?: string | null;
}

export function DiagnosticsPanel() {
  const [loading, setLoading] = useState(true);
  const [replayingId, setReplayingId] = useState<number | null>(null);
  const [replayingAll, setReplayingAll] = useState(false);
  const [dlqItems, setDlqItems] = useState<DlqItem[]>([]);
  const [stats, setStats] = useState<RelayStats>({
    totalRecent: 0,
    acceptedCount: 0,
    failedCount: 0,
  });

  const fetchDiagnostics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ops/relay/replay");
      if (!res.ok) throw new Error("Failed to load relay diagnostics");
      const json = await res.json();
      setDlqItems(json.dlqItems || []);
      setStats(json.stats || { totalRecent: 0, acceptedCount: 0, failedCount: 0 });
    } catch (err) {
      console.error(err);
      toast.error("Could not fetch relay diagnostics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDiagnostics();
  }, [fetchDiagnostics]);

  const handleReplayItem = async (id: number) => {
    setReplayingId(id);
    try {
      const res = await fetch("/api/ops/relay/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relayId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Replay failed");
      toast.success(`Batch #${id} successfully replayed to n8n!`);
      fetchDiagnostics();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Replay failed");
    } finally {
      setReplayingId(null);
    }
  };

  const handleReplayAll = async () => {
    setReplayingAll(true);
    try {
      const res = await fetch("/api/ops/relay/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allDeadLetter: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk replay failed");
      toast.success(
        `Bulk replay finished: ${data.succeeded} succeeded, ${data.failed} failed out of ${data.totalReplayed} items.`
      );
      fetchDiagnostics();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Bulk replay failed");
    } finally {
      setReplayingAll(false);
    }
  };

  const successRate =
    stats.totalRecent > 0
      ? Math.round((stats.acceptedCount / stats.totalRecent) * 100)
      : 100;

  return (
    <div className="w-full max-w-[1920px] mx-auto space-y-4">
      {/* Header with Title and Refresh */}
      <div className="p-4 bg-card rounded-xl border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold tracking-tight text-foreground">
              Automation Relay Diagnostics & DLQ
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time webhook forwarder health, Meta relay inbox buffer, and Dead Letter Queue recovery.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {dlqItems.length > 0 && (
            <Button
              size="sm"
              variant="destructive"
              className="h-8 text-xs font-bold gap-1.5"
              onClick={handleReplayAll}
              disabled={replayingAll || loading}
            >
              <RotateCcw className={cn("h-3.5 w-3.5", replayingAll && "animate-spin")} />
              Replay All DLQ Batches ({dlqItems.length})
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={fetchDiagnostics}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-card rounded-xl border border-border">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Server className="h-3.5 w-3.5 text-primary" />
            Recent Relay Batches
          </span>
          <div className="text-xl font-bold font-mono mt-1 text-foreground">
            {stats.totalRecent}
          </div>
        </div>

        <div className="p-3 bg-card rounded-xl border border-border">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            Accepted by n8n
          </span>
          <div className="text-xl font-bold font-mono mt-1 text-emerald-400">
            {stats.acceptedCount}
          </div>
        </div>

        <div className="p-3 bg-card rounded-xl border border-border">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <AlertOctagon className="h-3.5 w-3.5 text-red-400" />
            Dead Letter / Failed
          </span>
          <div className="text-xl font-bold font-mono mt-1 text-red-400">
            {stats.failedCount}
          </div>
        </div>

        <div className="p-3 bg-card rounded-xl border border-border">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-amber-400" />
            Delivery Success Rate
          </span>
          <div className="text-xl font-bold font-mono mt-1 text-foreground">
            {successRate}%
          </div>
        </div>
      </div>

      {/* Dead Letter Queue Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-3 border-b border-border bg-muted/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertOctagon className="h-4 w-4 text-red-400" />
            <h3 className="font-semibold text-xs text-foreground">
              Dead Letter Queue ({dlqItems.length})
            </h3>
          </div>
          <span className="text-[11px] text-muted-foreground">
            Transport failures with 5s finite timeout & backoff
          </span>
        </div>

        {dlqItems.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-xs">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-400 opacity-60" />
            <p className="font-medium text-foreground">Dead Letter Queue is Empty</p>
            <p className="text-[11px] mt-0.5">All WhatsApp webhook batches are successfully delivered to the automation engine.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-muted-foreground">
                  <th className="p-2.5 pl-4">ID</th>
                  <th className="p-2.5">Batch ID</th>
                  <th className="p-2.5">Attempts</th>
                  <th className="p-2.5">Last Error</th>
                  <th className="p-2.5">Failed At</th>
                  <th className="p-2.5 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dlqItems.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/30">
                    <td className="p-2.5 pl-4 font-mono font-medium text-muted-foreground">
                      #{item.id}
                    </td>
                    <td className="p-2.5 font-mono text-[11px] text-foreground">
                      {item.batch_id}
                    </td>
                    <td className="p-2.5">
                      <span className="font-mono px-2 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400 border border-red-500/20">
                        {item.attempts} attempts
                      </span>
                    </td>
                    <td className="p-2.5 text-red-300 font-mono text-[10px] max-w-sm truncate" title={item.last_error || ""}>
                      {item.last_error || "Unknown transport failure"}
                    </td>
                    <td className="p-2.5 text-muted-foreground text-[11px]">
                      {item.last_attempt_at ? new Date(item.last_attempt_at).toLocaleTimeString() : new Date(item.created_at).toLocaleTimeString()}
                    </td>
                    <td className="p-2.5 pr-4 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs font-semibold gap-1"
                        onClick={() => handleReplayItem(item.id)}
                        disabled={replayingId === item.id || loading}
                      >
                        <RotateCcw className={cn("h-3 w-3", replayingId === item.id && "animate-spin")} />
                        Replay
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
