"use client";

import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  Phone,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { canEditSettings } from "@/lib/auth/roles";

interface ReconciliationData {
  canonicalSenderId: string;
  legacySenderId: string;
  activeDbSender: string;
  allowedSenders: string[];
  isReconciled: boolean;
  aiEnabled: boolean;
  verifiedPhoneNumber?: string;
  blockingReason?: string | null;
}

export function SenderReconciliationPanel() {
  const { accountRole } = useAuth();
  const isAdmin = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [data, setData] = useState<ReconciliationData | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/sender-reconciliation");
      if (!res.ok) throw new Error("Failed to load sender reconciliation status");
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error(err);
      toast.error("Could not fetch sender reconciliation status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleReconcile = async () => {
    if (!isAdmin) {
      toast.error("Only administrators can reconcile sender IDs");
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch("/api/settings/sender-reconciliation", {
        method: "POST",
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Reconciliation failed");
      toast.success("Sender successfully reconciled and locked to verified ID 1167458436461085!");
      fetchStatus();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Reconciliation error");
    } finally {
      setActionLoading(false);
    }
  };

  const isReconciled = Boolean(data?.isReconciled);

  return (
    <div className="w-full max-w-[1920px] mx-auto space-y-4">
      {/* Header Bar */}
      <div className="p-4 bg-card rounded-xl border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold tracking-tight text-foreground">
              WhatsApp Sender Reconciliation & Migration
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Guarantees single verified Meta Phone Number ID across CRM, database, and automation workflows.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={fetchStatus}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Status & Blocking Gate Banner */}
      {isReconciled ? (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-start gap-3 text-xs text-emerald-300">
          <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold text-foreground text-sm flex items-center gap-2">
              <span>All Components Reconciled & Locked</span>
              <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 font-mono">
                Canonical: {data?.canonicalSenderId}
              </span>
            </div>
            <p className="text-emerald-300/80">
              The CRM database, runtime security guard, and n8n bridge all strictly match Phone Number ID{" "}
              <strong>1167458436461085</strong>. Outbound automation and AI advisor messaging are authorized.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start justify-between gap-4 text-xs text-red-300">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-red-400 shrink-0 mt-0.5 animate-pulse" />
            <div className="space-y-1">
              <div className="font-bold text-foreground text-sm flex items-center gap-2 text-red-400">
                <span>Activation Blocked: Sender ID Mismatch Detected</span>
              </div>
              <p className="text-red-300/80 max-w-2xl">
                The old n8n export references legacy Phone Number ID{" "}
                <code className="bg-red-500/20 px-1 py-0.5 rounded font-mono">
                  {data?.legacySenderId || "993172873887528"}
                </code>
                , while the verified Meta-registered ID is{" "}
                <code className="bg-emerald-500/20 px-1 py-0.5 rounded font-mono text-emerald-300">
                  {data?.canonicalSenderId || "1167458436461085"}
                </code>
                . Outbound automated outreach and AI agent activation are strictly blocked until reconciled.
              </p>
            </div>
          </div>

          {isAdmin && (
            <Button
              size="sm"
              className="bg-[#008069] hover:bg-[#008069]/90 text-white font-bold text-xs gap-1.5 shrink-0"
              onClick={handleReconcile}
              disabled={actionLoading}
            >
              <Lock className="h-3.5 w-3.5" />
              {actionLoading ? "Reconciling..." : "Reconcile & Lock Sender ID"}
            </Button>
          )}
        </div>
      )}

      {/* Comparison & Audit Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-3 border-b border-border bg-muted/40 flex items-center justify-between">
          <h3 className="font-semibold text-xs text-foreground">
            Registered Sender Comparison & Telemetry
          </h3>
          <span className="text-[11px] text-muted-foreground font-mono">Meta Graph API v21.0</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-muted-foreground">
                <th className="p-3 pl-4">Sender Designation</th>
                <th className="p-3">Phone Number ID</th>
                <th className="p-3">Status in Meta</th>
                <th className="p-3">Allowed in Runtime</th>
                <th className="p-3 pr-4 text-right">Action / Recommendation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {/* Verified Canonical Row */}
              <tr className="hover:bg-muted/30">
                <td className="p-3 pl-4 font-semibold text-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <div>
                    <span>Primary Verified Sender</span>
                    <div className="text-[11px] text-muted-foreground">Registered WhatsApp Business Account</div>
                  </div>
                </td>
                <td className="p-3 font-mono font-bold text-emerald-400">
                  {data?.canonicalSenderId || "1167458436461085"}
                </td>
                <td className="p-3">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    <ShieldCheck className="h-3 w-3" />
                    Credentials Valid & Registered
                  </span>
                </td>
                <td className="p-3">
                  {data?.allowedSenders?.includes(data?.canonicalSenderId || "1167458436461085") ? (
                    <span className="text-emerald-400 font-semibold font-mono text-[11px]">ALLOWED</span>
                  ) : (
                    <span className="text-amber-400 font-semibold font-mono text-[11px]">PENDING SYNC</span>
                  )}
                </td>
                <td className="p-3 pr-4 text-right">
                  <span className="text-xs text-muted-foreground">Active Target</span>
                </td>
              </tr>

              {/* Legacy Deprecated Row */}
              <tr className="hover:bg-muted/30 bg-red-500/5">
                <td className="p-3 pl-4 font-semibold text-foreground flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                  <div>
                    <span>Legacy n8n Export Reference</span>
                    <div className="text-[11px] text-muted-foreground">Outdated automation workflow export</div>
                  </div>
                </td>
                <td className="p-3 font-mono text-muted-foreground line-through">
                  {data?.legacySenderId || "993172873887528"}
                </td>
                <td className="p-3">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/30">
                    Deprecated / Unsafe
                  </span>
                </td>
                <td className="p-3">
                  {data?.allowedSenders?.includes(data?.legacySenderId || "993172873887528") ? (
                    <span className="text-red-400 font-bold font-mono text-[11px]">EXPOSED (BLOCKED)</span>
                  ) : (
                    <span className="text-emerald-400 font-semibold font-mono text-[11px]">DISABLED</span>
                  )}
                </td>
                <td className="p-3 pr-4 text-right">
                  <span className="text-xs text-red-400 font-medium">Do Not Use</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
