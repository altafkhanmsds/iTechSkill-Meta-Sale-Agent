"use client";

import { useEffect, useState, useCallback } from "react";
import {
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
  Radio,
  ShieldAlert,
  Users,
  Clock,
  Loader2,
  RefreshCw,
  Power,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { canEditSettings } from "@/lib/auth/roles";

interface CallHandoff {
  request_id: string;
  provider_call_id?: string | null;
  call_id?: string;
  phone: string;
  status: string;
  assigned_agent_id?: string | null;
  agent_id?: string | null;
  duration_seconds?: number | null;
  created_at: string;
  requested_at?: string;
  metadata?: Record<string, unknown>;
}

export function LiveCallConsole() {
  const { accountRole } = useAuth();
  const isAdmin = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [callRoutingEnabled, setCallRoutingEnabled] = useState(false);
  const [activeCalls, setActiveCalls] = useState<CallHandoff[]>([]);
  const [recentCalls, setRecentCalls] = useState<CallHandoff[]>([]);
  const [agentsOnline, setAgentsOnline] = useState(0);
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // 1. Send Presence Heartbeat every 20 seconds while this console is active
  useEffect(() => {
    const sendHeartbeat = async () => {
      try {
        const res = await fetch("/api/calls/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "available" }),
        });
        if (res.ok) {
          setLastHeartbeat(new Date());
        }
      } catch (err) {
        console.warn("[live-calls] heartbeat error:", err);
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 20000);
    return () => clearInterval(interval);
  }, []);

  // 2. Fetch Active Calls and Call Routing Status
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ops/calls");
      if (!res.ok) throw new Error("Failed to load call operations");
      const json = await res.json();
      setCallRoutingEnabled(Boolean(json.callRoutingEnabled));
      setActiveCalls(json.activeCalls || []);
      setRecentCalls(json.recentCalls || []);
      setAgentsOnline(json.agentsOnline || 0);
    } catch (err) {
      console.error(err);
      toast.error("Could not refresh live call operations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const pollInterval = setInterval(fetchData, 10000);
    return () => clearInterval(pollInterval);
  }, [fetchData]);

  // 3. Toggle Call Routing (Admin only)
  const handleToggleRouting = async () => {
    if (!isAdmin) {
      toast.error("Only administrators can toggle call routing");
      return;
    }

    const nextState = !callRoutingEnabled;
    setActionLoading(true);
    try {
      const res = await fetch("/api/ops/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_routing", enabled: nextState }),
      });
      if (!res.ok) throw new Error("Failed to update call routing");
      setCallRoutingEnabled(nextState);
      toast.success(
        nextState
          ? "Call routing ACTIVATED. Live inbound calls will route to active human agents."
          : "Call routing PAUSED. Inbound calls will safely fallback to voicemail."
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle routing");
    } finally {
      setActionLoading(false);
    }
  };

  // 4. Emergency Call Takeover
  const handleTakeover = async (call: CallHandoff) => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/ops/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "takeover",
          requestId: call.request_id || call.call_id,
          phone: call.phone,
        }),
      });
      if (!res.ok) throw new Error("Takeover failed");
      toast.success(`Emergency takeover activated for ${call.phone}! Bot disconnected.`);
      fetchData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to takeover call");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[1920px] mx-auto space-y-4">
      {/* Top Banner: Presence and Master Switch */}
      <div className="p-4 bg-card rounded-xl border border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-emerald-500 animate-pulse" />
            <h2 className="text-lg font-bold tracking-tight text-foreground">
              Live Call Routing Console
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Presence heartbeat active. Voice calls route to available human agents or safely fallback to voicemail.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Agent Presence Status Badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted border border-border text-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
            <span className="font-semibold text-foreground">You are Online</span>
            <span className="text-muted-foreground font-mono text-[10px]">
              ({lastHeartbeat ? `synced ${lastHeartbeat.toLocaleTimeString()}` : "connecting..."})
            </span>
          </div>

          {/* Active Agents Online Counter */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted border border-border text-xs">
            <Users className="h-3.5 w-3.5 text-primary" />
            <span className="text-muted-foreground">Active Agents:</span>
            <span className="font-bold text-foreground">{agentsOnline}</span>
          </div>

          {/* Routing Master Toggle */}
          {isAdmin && (
            <Button
              size="sm"
              variant={callRoutingEnabled ? "destructive" : "default"}
              className={cn(
                "h-8 text-xs font-bold gap-1.5 shadow-sm transition-all",
                !callRoutingEnabled && "bg-[#008069] hover:bg-[#008069]/90 text-white"
              )}
              onClick={handleToggleRouting}
              disabled={actionLoading}
            >
              <Power className="h-3.5 w-3.5" />
              {callRoutingEnabled ? "Pause Inbound Calls" : "Activate Inbound Calls"}
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Safety Notice Banner */}
      {!callRoutingEnabled && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center gap-3 text-xs text-amber-400">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <div>
            <strong>Safe Default Enforced:</strong> Live phone call routing is currently paused. All incoming calls safely record voicemails or follow standard queues without ringing phones unexpectedly.
          </div>
        </div>
      )}

      {/* Active & In-Progress Calls */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-3 border-b border-border bg-muted/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PhoneCall className="h-4 w-4 text-emerald-400" />
            <h3 className="font-semibold text-xs text-foreground">
              Active Inbound Calls ({activeCalls.length})
            </h3>
          </div>
          <span className="text-[11px] text-muted-foreground">Auto-updates every 10s</span>
        </div>

        {activeCalls.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-xs">
            <Volume2 className="h-8 w-8 mx-auto mb-2 opacity-30 text-emerald-400" />
            <p className="font-medium text-foreground">No calls currently active</p>
            <p className="text-[11px] mt-0.5">When an inbound phone call arrives, it will appear here with live takeover controls.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-muted-foreground">
                  <th className="p-2.5 pl-4">Caller Phone</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Assigned To</th>
                  <th className="p-2.5">Started At</th>
                  <th className="p-2.5 pr-4 text-right">Emergency Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeCalls.map((call) => (
                  <tr key={call.request_id || call.call_id || call.phone} className="hover:bg-muted/30">
                    <td className="p-2.5 pl-4 font-mono font-bold text-foreground">
                      {call.phone}
                    </td>
                    <td className="p-2.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 animate-pulse">
                        <Radio className="h-2.5 w-2.5" />
                        {call.status}
                      </span>
                    </td>
                    <td className="p-2.5 text-muted-foreground">
                      {call.assigned_agent_id || call.agent_id || "Automated Routing"}
                    </td>
                    <td className="p-2.5 text-muted-foreground">
                      {new Date(call.requested_at || call.created_at).toLocaleTimeString()}
                    </td>
                    <td className="p-2.5 pr-4 text-right">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs font-bold gap-1"
                        onClick={() => handleTakeover(call)}
                        disabled={actionLoading}
                      >
                        <PhoneForwarded className="h-3.5 w-3.5" />
                        Emergency Takeover
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Calls Log */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-3 border-b border-border bg-muted/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-xs text-foreground">
              Recent Call History (Last 24 Hours)
            </h3>
          </div>
          <span className="text-[11px] text-muted-foreground">{recentCalls.length} calls logged</span>
        </div>

        {recentCalls.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-xs">
            No calls recorded in the last 24 hours.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-muted-foreground">
                  <th className="p-2.5 pl-4">Caller Phone</th>
                  <th className="p-2.5">Outcome</th>
                  <th className="p-2.5">Duration</th>
                  <th className="p-2.5">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentCalls.slice(0, 10).map((call) => (
                  <tr key={call.request_id || call.call_id || `${call.phone}-${call.created_at}`} className="hover:bg-muted/30">
                    <td className="p-2.5 pl-4 font-mono font-medium text-foreground">
                      {call.phone}
                    </td>
                    <td className="p-2.5">
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-semibold border",
                          call.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : call.status === "human_takeover"
                            ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                            : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                        )}
                      >
                        {call.status}
                      </span>
                    </td>
                    <td className="p-2.5 text-muted-foreground">
                      {call.duration_seconds ? `${call.duration_seconds}s` : "N/A"}
                    </td>
                    <td className="p-2.5 text-muted-foreground">
                      {new Date(call.created_at).toLocaleString()}
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
