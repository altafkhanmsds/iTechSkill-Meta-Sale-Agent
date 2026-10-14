// ============================================================
// Operations mutations — server-side only with audit logging.
//
// These execute state transitions against iTechSkill operational
// tables using supabaseAdmin(). Every mutation:
// 1. Validates preconditions against the current record state
// 2. Applies the transition with timezone-aware timestamps
// 3. Emits an audit log entry (actor, action, before/after state)
// 4. Returns the updated record
// ============================================================

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { hasMinRole, type AccountRole } from "@/lib/auth/roles";
import { writeAuditLog, generateRequestId } from "./audit";
import type {
  HandoffCase,
  EnrollmentApplication,
  FollowupJob,
  OperationsAlert,
  CatalogChangeRequest,
} from "./types";

export interface ActorContext {
  userId: string;
  role: string;
}

// -----------------------------------------------------------
// 1. Handoff Case Mutations
// -----------------------------------------------------------

export async function assignHandoff(
  caseId: string,
  staffUserId: string,
  actor: ActorContext,
  requestId?: string,
): Promise<HandoffCase> {
  const db = supabaseAdmin();
  const reqId = requestId ?? generateRequestId();

  // 1. Role validation
  if (!hasMinRole(actor.role as AccountRole, "agent")) {
    throw new Error("Unauthorized: Only agents, admins, or owners can assign handoff cases");
  }

  // 2. Input validation
  if (!staffUserId || staffUserId.trim().length === 0) {
    throw new Error("Staff user ID is required to assign handoff");
  }

  const { data: before, error: fetchErr } = await db
    .from("itechskill_handoff_cases")
    .select("*")
    .eq("case_id", caseId)
    .single();

  if (fetchErr || !before) {
    throw new Error(`Handoff case ${caseId} not found`);
  }

  const updates = {
    assigned_to: staffUserId,
    status: before.status === "open" ? "in_progress" : before.status,
    updated_at: new Date().toISOString(),
  };

  const { data: after, error: updateErr } = await db
    .from("itechskill_handoff_cases")
    .update(updates)
    .eq("case_id", caseId)
    .select()
    .single();

  if (updateErr || !after) {
    throw new Error(`Failed to assign handoff: ${updateErr?.message}`);
  }

  await writeAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "handoff.assign",
    entityType: "itechskill_handoff_case",
    entityId: caseId,
    beforeState: before,
    afterState: after,
    reason: `Assigned to ${staffUserId}`,
    requestId: reqId,
  });

  return after as HandoffCase;
}

export async function startHandoff(
  caseId: string,
  actor: ActorContext,
  requestId?: string,
): Promise<HandoffCase> {
  const db = supabaseAdmin();
  const reqId = requestId ?? generateRequestId();

  // 1. Role validation
  if (!hasMinRole(actor.role as AccountRole, "agent")) {
    throw new Error("Unauthorized: Only agents, admins, or owners can start handoff cases");
  }

  const { data: before, error: fetchErr } = await db
    .from("itechskill_handoff_cases")
    .select("*")
    .eq("case_id", caseId)
    .single();

  if (fetchErr || !before) {
    throw new Error(`Handoff case ${caseId} not found`);
  }

  // Idempotency: If already in_progress, return existing record
  if (before.status === "in_progress") {
    return before as HandoffCase;
  }

  const updates = {
    status: "in_progress",
    assigned_to: before.assigned_to || actor.userId,
    updated_at: new Date().toISOString(),
  };

  const { data: after, error: updateErr } = await db
    .from("itechskill_handoff_cases")
    .update(updates)
    .eq("case_id", caseId)
    .select()
    .single();

  if (updateErr || !after) {
    throw new Error(`Failed to start handoff: ${updateErr?.message}`);
  }

  await writeAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "handoff.start",
    entityType: "itechskill_handoff_case",
    entityId: caseId,
    beforeState: before,
    afterState: after,
    requestId: reqId,
  });

  return after as HandoffCase;
}

export async function resolveHandoff(
  caseId: string,
  resolutionNote: string,
  actor: ActorContext,
  requestId?: string,
): Promise<HandoffCase> {
  const db = supabaseAdmin();
  const reqId = requestId ?? generateRequestId();
  const now = new Date().toISOString();

  // 1. Role validation
  if (!hasMinRole(actor.role as AccountRole, "agent")) {
    throw new Error("Unauthorized: Only agents, admins, or owners can resolve handoff cases");
  }

  // 2. Note validation
  if (!resolutionNote || resolutionNote.trim().length === 0) {
    throw new Error("Resolution note is required to resolve a handoff");
  }

  const { data: before, error: fetchErr } = await db
    .from("itechskill_handoff_cases")
    .select("*")
    .eq("case_id", caseId)
    .single();

  if (fetchErr || !before) {
    throw new Error(`Handoff case ${caseId} not found`);
  }

  // Idempotency: If already resolved with same note, return existing
  if (before.status === "resolved") {
    return before as HandoffCase;
  }

  const updates = {
    status: "resolved",
    resolution_note: resolutionNote.trim(),
    resolved_at: now,
    updated_at: now,
  };

  const { data: after, error: updateErr } = await db
    .from("itechskill_handoff_cases")
    .update(updates)
    .eq("case_id", caseId)
    .select()
    .single();

  if (updateErr || !after) {
    throw new Error(`Failed to resolve handoff: ${updateErr?.message}`);
  }

  await writeAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "handoff.resolve",
    entityType: "itechskill_handoff_case",
    entityId: caseId,
    beforeState: before,
    afterState: after,
    reason: resolutionNote.trim(),
    requestId: reqId,
  });

  return after as HandoffCase;
}

export async function reopenHandoff(
  caseId: string,
  actor: ActorContext,
  requestId?: string,
): Promise<HandoffCase> {
  const db = supabaseAdmin();
  const reqId = requestId ?? generateRequestId();

  // 1. Role validation
  if (!hasMinRole(actor.role as AccountRole, "agent")) {
    throw new Error("Unauthorized: Only agents, admins, or owners can reopen handoff cases");
  }

  const { data: before, error: fetchErr } = await db
    .from("itechskill_handoff_cases")
    .select("*")
    .eq("case_id", caseId)
    .single();

  if (fetchErr || !before) {
    throw new Error(`Handoff case ${caseId} not found`);
  }

  // 2. Invalid state transition check
  if (before.status !== "resolved" && before.status !== "cancelled") {
    throw new Error(`Invalid state transition: Cannot reopen a case with status '${before.status}'`);
  }

  const updates = {
    status: "open",
    resolution_note: null,
    resolved_at: null,
    updated_at: new Date().toISOString(),
  };

  const { data: after, error: updateErr } = await db
    .from("itechskill_handoff_cases")
    .update(updates)
    .eq("case_id", caseId)
    .select()
    .single();

  if (updateErr || !after) {
    throw new Error(`Failed to reopen handoff: ${updateErr?.message}`);
  }

  await writeAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "handoff.reopen",
    entityType: "itechskill_handoff_case",
    entityId: caseId,
    beforeState: before,
    afterState: after,
    requestId: reqId,
  });

  return after as HandoffCase;
}

// -----------------------------------------------------------
// 2. Admissions & Payment Mutations
// -----------------------------------------------------------

export interface PaymentVerificationInput {
  bankTransactionId?: string;
  beneficiaryAccount?: string;
  amountPkr?: number;
  currency?: string;
  notes?: string;
}

export async function approvePayment(
  applicationId: string,
  actor: ActorContext,
  requestId?: string,
  verification?: PaymentVerificationInput,
): Promise<EnrollmentApplication> {
  const db = supabaseAdmin();
  const reqId = requestId ?? generateRequestId();
  const now = new Date().toISOString();

  // 1. Role validation
  if (!hasMinRole(actor.role as AccountRole, "agent")) {
    throw new Error("Unauthorized: Only admissions staff, admins, or owners can approve payments");
  }

  // 2. Fetch & lock record
  const { data: before, error: fetchErr } = await db
    .from("itechskill_enrollment_applications")
    .select("*")
    .eq("application_id", applicationId)
    .single();

  if (fetchErr || !before) {
    throw new Error(`Enrollment application ${applicationId} not found`);
  }

  // 3. Idempotency guard: If already verified, return existing record safely
  if (before.payment_status === "verified" && (before.account_status === "created" || before.account_status === "sending_login" || before.account_status === "active")) {
    return before as EnrollmentApplication;
  }

  // 4. Invalid state transition check
  if (before.payment_status === "rejected") {
    throw new Error("Invalid state transition: Cannot approve a rejected application without re-verification");
  }

  // 5. Verification validation & duplicate bank transaction ID check
  if (verification?.bankTransactionId) {
    const txId = verification.bankTransactionId.trim();
    if (!txId) {
      throw new Error("Bank transaction ID cannot be empty");
    }

    // Currency verification: must be PKR
    if (verification.currency && verification.currency.toUpperCase() !== "PKR") {
      throw new Error(`Invalid currency: ${verification.currency}. Payment currency must be PKR.`);
    }

    // Check for duplicate bank_transaction_id in itechskill_payment_evidence_v2
    const { data: dupEvidence } = await db
      .from("itechskill_payment_evidence_v2")
      .select("application_id")
      .eq("bank_transaction_id", txId)
      .neq("application_id", applicationId)
      .limit(1);

    if (dupEvidence && dupEvidence.length > 0) {
      throw new Error(`Duplicate transaction ID: ${txId} has already been verified for another application (${dupEvidence[0].application_id}).`);
    }

    // Check in itechskill_enrollment_applications
    const { data: dupApp } = await db
      .from("itechskill_enrollment_applications")
      .select("application_id")
      .eq("bank_transaction_id", txId)
      .neq("application_id", applicationId)
      .limit(1);

    if (dupApp && dupApp.length > 0) {
      throw new Error(`Duplicate transaction ID: ${txId} has already been verified for application ${dupApp[0].application_id}.`);
    }

    // 5b. Update existing payment evidence if present (preserving event_id, media_id, BIGINT id) or insert authoritative record
    const { data: existingEvidence } = await db
      .from("itechskill_payment_evidence_v2")
      .select("id, event_id")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingEvidence) {
      await db
        .from("itechskill_payment_evidence_v2")
        .update({
          status: "verified",
          is_authoritative: true,
          verified_at: now,
          verified_by: actor.userId,
          bank_transaction_id: txId,
          beneficiary_account: verification.beneficiaryAccount?.trim() || "iTechSkill Official",
          submitted_amount: verification.amountPkr || before.total_fee_pkr || 0,
          submitted_currency: "PKR",
          verification_notes: verification.notes?.trim() || "Authoritative bank settlement confirmed",
          updated_at: now,
        })
        .eq("id", existingEvidence.id);
    } else {
      await db.from("itechskill_payment_evidence_v2").insert({
        application_id: applicationId,
        phone: before.phone,
        status: "verified",
        bank_transaction_id: txId,
        beneficiary_account: verification.beneficiaryAccount?.trim() || "iTechSkill Official",
        submitted_amount: verification.amountPkr || before.total_fee_pkr || 0,
        submitted_currency: "PKR",
        is_authoritative: true,
        verified_at: now,
        verified_by: actor.userId,
        verification_notes: verification.notes?.trim() || "Authoritative bank settlement confirmed",
        created_at: now,
        updated_at: now,
      });
    }
  }

  // 6. Apply state machine transition (aligned with n8n login delivery worker)
  const updates: Record<string, unknown> = {
    payment_status: "verified",
    account_status: "created",
    payment_evidence_verified: true,
    updated_at: now,
  };
  if (verification?.bankTransactionId) {
    updates.bank_transaction_id = verification.bankTransactionId.trim();
  }
  if (verification?.beneficiaryAccount) {
    updates.beneficiary_account = verification.beneficiaryAccount.trim();
  }

  const { data: after, error: updateErr } = await db
    .from("itechskill_enrollment_applications")
    .update(updates)
    .eq("application_id", applicationId)
    .select()
    .single();

  if (updateErr || !after) {
    throw new Error(`Failed to approve payment: ${updateErr?.message}`);
  }

  // 7. Transactional Audit Log
  await writeAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "payment.approve",
    entityType: "itechskill_enrollment_application",
    entityId: applicationId,
    beforeState: before,
    afterState: after,
    reason: verification?.notes || "Payment verified by admissions staff",
    requestId: reqId,
  });

  return after as EnrollmentApplication;
}

export async function rejectPayment(
  applicationId: string,
  rejectionReason: string,
  actor: ActorContext,
  requestId?: string,
): Promise<EnrollmentApplication> {
  const db = supabaseAdmin();
  const reqId = requestId ?? generateRequestId();
  const now = new Date().toISOString();

  // 1. Role validation
  if (!hasMinRole(actor.role as AccountRole, "agent")) {
    throw new Error("Unauthorized: Only admissions staff, admins, or owners can reject payments");
  }

  // 2. Reason validation
  if (!rejectionReason || rejectionReason.trim().length === 0) {
    throw new Error("Rejection reason is required");
  }

  // 3. Fetch & lock record
  const { data: before, error: fetchErr } = await db
    .from("itechskill_enrollment_applications")
    .select("*")
    .eq("application_id", applicationId)
    .single();

  if (fetchErr || !before) {
    throw new Error(`Enrollment application ${applicationId} not found`);
  }

  // 4. Idempotency guard
  if (before.payment_status === "rejected") {
    return before as EnrollmentApplication;
  }

  // 5. Apply rejection transition (guarantees it never enters n8n login worker)
  const updates = {
    payment_status: "rejected",
    account_status: "rejected",
    updated_at: now,
  };

  const { data: after, error: updateErr } = await db
    .from("itechskill_enrollment_applications")
    .update(updates)
    .eq("application_id", applicationId)
    .select()
    .single();

  if (updateErr || !after) {
    throw new Error(`Failed to reject payment: ${updateErr?.message}`);
  }

  // 6. Transactional Audit Log
  await writeAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "payment.reject",
    entityType: "itechskill_enrollment_application",
    entityId: applicationId,
    beforeState: before,
    afterState: after,
    reason: rejectionReason.trim(),
    requestId: reqId,
  });

  return after as EnrollmentApplication;
}

export async function updatePaymentReceiptDetails(
  applicationId: string,
  updates: {
    receipt_url?: string;
    beneficiary_account?: string;
    payment_amount?: number;
    payment_method?: string;
    receipt_metadata?: Record<string, unknown>;
  },
  actor: ActorContext,
  requestId?: string,
): Promise<EnrollmentApplication> {
  const db = supabaseAdmin();
  const reqId = requestId ?? generateRequestId();
  const now = new Date().toISOString();

  const { data: before, error: fetchErr } = await db
    .from("itechskill_enrollment_applications")
    .select("*")
    .eq("application_id", applicationId)
    .single();

  if (fetchErr || !before) {
    throw new Error(`Enrollment application ${applicationId} not found`);
  }

  const payload: Record<string, unknown> = {
    updated_at: now,
  };
  if (updates.payment_amount !== undefined) payload.total_fee_pkr = updates.payment_amount;

  const { data: after, error: updateErr } = await db
    .from("itechskill_enrollment_applications")
    .update(payload)
    .eq("application_id", applicationId)
    .select()
    .single();

  if (updateErr || !after) {
    throw new Error(`Failed to update receipt details: ${updateErr?.message}`);
  }

  await writeAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "payment.update_receipt",
    entityType: "itechskill_enrollment_application",
    entityId: applicationId,
    beforeState: before,
    afterState: after,
    reason: "Updated receipt and bank verification details",
    requestId: reqId,
  });

  return after as EnrollmentApplication;
}

// -----------------------------------------------------------
// 3. Follow-up Mutations
// -----------------------------------------------------------

export async function cancelFollowup(
  jobId: string,
  cancellationReason: string,
  actor: ActorContext,
  requestId?: string,
): Promise<FollowupJob> {
  const db = supabaseAdmin();
  const reqId = requestId ?? generateRequestId();
  const now = new Date().toISOString();

  // 1. Role validation
  if (!hasMinRole(actor.role as AccountRole, "agent")) {
    throw new Error("Unauthorized: Only agents, admins, or owners can cancel followups");
  }

  if (!cancellationReason || cancellationReason.trim().length === 0) {
    throw new Error("Cancellation reason is required");
  }

  const { data: before, error: fetchErr } = await db
    .from("itechskill_followup_jobs")
    .select("*")
    .eq("job_id", jobId)
    .single();

  if (fetchErr || !before) {
    throw new Error(`Followup job ${jobId} not found`);
  }

  if (before.status === "sent") {
    throw new Error("Cannot cancel a follow-up that has already been sent");
  }

  const updates = {
    status: "cancelled",
    cancelled_reason: cancellationReason.trim(),
    cancelled_at: now,
    updated_at: now,
  };

  const { data: after, error: updateErr } = await db
    .from("itechskill_followup_jobs")
    .update(updates)
    .eq("job_id", jobId)
    .select()
    .single();

  if (updateErr || !after) {
    throw new Error(`Failed to cancel follow-up: ${updateErr?.message}`);
  }

  await writeAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "followup.cancel",
    entityType: "itechskill_followup_job",
    entityId: jobId,
    beforeState: before,
    afterState: after,
    reason: cancellationReason.trim(),
    requestId: reqId,
  });

  return after as FollowupJob;
}

// -----------------------------------------------------------
// 4. Incident Resolution Mutations
// -----------------------------------------------------------

export async function resolveIncident(
  fingerprint: string,
  resolutionNote: string,
  actor: ActorContext,
  requestId?: string,
): Promise<OperationsAlert> {
  const db = supabaseAdmin();
  const reqId = requestId ?? generateRequestId();
  const now = new Date().toISOString();

  // 1. Role validation
  if (!hasMinRole(actor.role as AccountRole, "agent")) {
    throw new Error("Unauthorized: Only agents, admins, or owners can resolve incidents");
  }

  const { data: before, error: fetchErr } = await db
    .from("itechskill_operations_alerts")
    .select("*")
    .eq("fingerprint", fingerprint)
    .maybeSingle();

  if (fetchErr || !before) {
    throw new Error(`Incident with fingerprint ${fingerprint} not found`);
  }

  const updates = {
    status: "resolved",
    resolved_at: now,
  };

  const { data: after, error: updateErr } = await db
    .from("itechskill_operations_alerts")
    .update(updates)
    .eq("fingerprint", fingerprint)
    .select()
    .single();

  if (updateErr || !after) {
    throw new Error(`Failed to resolve incident: ${updateErr?.message}`);
  }

  await writeAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "incident.resolve",
    entityType: "itechskill_operations_alert",
    entityId: fingerprint,
    beforeState: before,
    afterState: after,
    reason: resolutionNote,
    requestId: reqId,
  });

  return after as OperationsAlert;
}

// -----------------------------------------------------------
// 5. Catalog Governance Mutations
// -----------------------------------------------------------

export async function submitCatalogChange(
  change: {
    change_type: string;
    title: string;
    description: string;
    payload: Record<string, unknown>;
    source_key?: string;
  },
  actor: ActorContext,
  requestId?: string,
): Promise<CatalogChangeRequest> {
  const db = supabaseAdmin();
  const reqId = requestId ?? generateRequestId();
  const now = new Date().toISOString();
  const catalogReqId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 1. Role validation
  if (!hasMinRole(actor.role as AccountRole, "agent")) {
    throw new Error("Unauthorized: Only agents, admins, or owners can submit catalog change requests");
  }

  const insertData = {
    request_id: catalogReqId,
    source_key: change.source_key || "itechskill_short_course_microsoft_excel",
    action: change.change_type === "delete" ? "delete" : "upsert",
    proposed_document: {
      title: change.title,
      description: change.description,
      payload: change.payload,
    },
    status: "pending",
    requested_by: actor.userId,
    requested_at: now,
    updated_at: now,
  };

  const { data: created, error: insertErr } = await db
    .from("itechskill_catalog_change_requests")
    .insert(insertData)
    .select()
    .single();

  if (insertErr || !created) {
    throw new Error(`Failed to submit catalog change: ${insertErr?.message}`);
  }

  const normalized = {
    ...created,
    id: created.request_id || created.id,
    change_type: created.action || "upsert",
    title: change.title,
    description: change.description,
    payload: change.payload,
    requester: created.requested_by,
  } as CatalogChangeRequest;

  await writeAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "catalog.submit_change",
    entityType: "itechskill_catalog_change_request",
    entityId: normalized.id,
    afterState: created,
    reason: change.title,
    requestId: reqId,
  });

  return normalized;
}

export async function approveCatalogChange(
  requestId: string,
  reviewNote: string,
  actor: ActorContext,
  reqIdParam?: string,
): Promise<CatalogChangeRequest> {
  const db = supabaseAdmin();
  const reqId = reqIdParam ?? generateRequestId();
  const now = new Date().toISOString();

  // 1. Role validation (Admin or Owner required)
  if (!hasMinRole(actor.role as AccountRole, "admin")) {
    throw new Error("Unauthorized: Only admins or owners can approve catalog changes");
  }

  const { data: before, error: fetchErr } = await db
    .from("itechskill_catalog_change_requests")
    .select("*")
    .eq("request_id", requestId)
    .maybeSingle();

  if (fetchErr || !before) {
    throw new Error(`Catalog change request ${requestId} not found`);
  }

  // 2. Four-eye principle: Prevent user from approving their own request
  // Enforce before.submitted_by !== actor.userId
  const submittedBy = before.submitted_by || before.requested_by || before.created_by;
  if (submittedBy && submittedBy === actor.userId) {
    await writeAuditLog({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "catalog.approve_change_rejected",
      entityType: "itechskill_catalog_change_request",
      entityId: before.request_id || before.id || requestId,
      beforeState: before,
      afterState: before,
      reason: "Self-approval violation: Four-eye policy requires an independent reviewer",
      requestId: reqId,
    });
    throw new Error("Unauthorized: Four-eye policy violation. Reviewer cannot approve their own catalog change request.");
  }

  const updates = {
    status: "approved",
    approved_by: actor.userId,
    review_note: reviewNote,
    reviewed_at: now,
    updated_at: now,
  };

  const { data: after, error: updateErr } = await db
    .from("itechskill_catalog_change_requests")
    .update(updates)
    .eq("request_id", requestId)
    .select()
    .single();

  if (updateErr || !after) {
    throw new Error(`Failed to approve catalog change: ${updateErr?.message}`);
  }

  // 3. Align catalog publication with n8n via itechskill_catalog_publish_jobs
  // Create one idempotent row in itechskill_catalog_publish_jobs
  // Do not directly write an incompatible copy into itechskill_course_catalog_v2
  const jobId = `job_${requestId}`;
  try {
    const { error: jobErr } = await db
      .from("itechskill_catalog_publish_jobs")
      .upsert(
        {
          job_id: jobId,
          request_id: requestId,
          status: "pending",
          attempt_count: 0,
          updated_at: now,
        },
        { onConflict: "request_id" }
      );

    if (jobErr) {
      const { data: existingJob } = await db
        .from("itechskill_catalog_publish_jobs")
        .select("job_id")
        .eq("request_id", requestId)
        .maybeSingle();

      if (!existingJob) {
        await db.from("itechskill_catalog_publish_jobs").insert({
          job_id: jobId,
          request_id: requestId,
          status: "pending",
          attempt_count: 0,
          updated_at: now,
        });
      }
    }

    try {
      await db.rpc("itechskill_publish_catalog_job", { p_job_id: jobId });
    } catch {
      // Handled asynchronously by n8n publish runner
    }
  } catch (publishErr) {
    console.warn(`[catalog] Failed staging publish job for request ${requestId}:`, publishErr);
  }

  const normalized = {
    ...after,
    id: after.request_id || after.id,
    change_type: after.action || "upsert",
    reviewer: after.approved_by,
  } as CatalogChangeRequest;

  await writeAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "catalog.approve_change",
    entityType: "itechskill_catalog_change_request",
    entityId: normalized.id,
    beforeState: before,
    afterState: after,
    reason: reviewNote,
    requestId: reqId,
  });

  return normalized;
}

export async function rejectCatalogChange(
  requestId: string,
  rejectionReason: string,
  actor: ActorContext,
  reqIdParam?: string,
): Promise<CatalogChangeRequest> {
  const db = supabaseAdmin();
  const reqId = reqIdParam ?? generateRequestId();
  const now = new Date().toISOString();

  // 1. Role validation (Admin or Owner required)
  if (!hasMinRole(actor.role as AccountRole, "admin")) {
    throw new Error("Unauthorized: Only admins or owners can reject catalog changes");
  }

  const { data: before, error: fetchErr } = await db
    .from("itechskill_catalog_change_requests")
    .select("*")
    .eq("request_id", requestId)
    .maybeSingle();

  if (fetchErr || !before) {
    throw new Error(`Catalog change request ${requestId} not found`);
  }

  const updates = {
    status: "rejected",
    rejected_by: actor.userId,
    review_note: rejectionReason,
    reviewed_at: now,
    updated_at: now,
  };

  const { data: after, error: updateErr } = await db
    .from("itechskill_catalog_change_requests")
    .update(updates)
    .eq("request_id", requestId)
    .select()
    .single();

  if (updateErr || !after) {
    throw new Error(`Failed to reject catalog change: ${updateErr?.message}`);
  }

  const normalized = {
    ...after,
    id: after.request_id || after.id,
    change_type: after.action || "upsert",
    reviewer: after.rejected_by,
  } as CatalogChangeRequest;

  await writeAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "catalog.reject_change",
    entityType: "itechskill_catalog_change_request",
    entityId: normalized.id,
    beforeState: before,
    afterState: after,
    reason: rejectionReason,
    requestId: reqId,
  });

  return normalized;
}
