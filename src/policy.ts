import { z } from "zod";
import { stableHash } from "./hash.js";

export type ApprovalBinding = {
  entityId: string;
  entityType: string;
  version: number;
  contentHash: string;
  scope: string;
  decision: "approved" | "rejected" | "revoked";
  expiresAt?: string | null;
};

export type FreshnessBinding = {
  entityId: string;
  entityType: string;
  version: number;
  state: "current" | "aging" | "stale" | "unknown" | "not_applicable";
};

export const reviewCommandSchema = z.object({
  entityId: z.string().min(1),
  entityType: z.string().min(1),
  version: z.number().int().positive(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  decision: z.enum(["approved", "rejected", "request_changes"]),
  scope: z.string().min(1),
  comment: z.string().max(1000).default("")
});

export const enrichmentCommandSchema = z.object({
  personId: z.string().min(1),
  personVersion: z.number().int().positive(),
  personApproval: z.literal("approved"),
  provider: z.literal("apollo"),
  estimatedCredits: z.number().int().nonnegative(),
  approvedCreditCap: z.number().int().nonnegative()
});

export const manualActivitySchema = z.object({
  activityId: z.string().min(1),
  channel: z.enum(["email", "linkedin", "phone", "voicemail"]),
  status: z.literal("completed_manual"),
  occurredAt: z.string().datetime(),
  outcome: z.string().min(1).max(1000)
});

export function approvalMatches(
  approval: ApprovalBinding | undefined,
  target: { entityId: string; entityType: string; version: number; contentHash: string; scope: string },
  now = new Date()
): boolean {
  if (!approval || approval.decision !== "approved") return false;
  if (approval.entityId !== target.entityId || approval.entityType !== target.entityType) return false;
  if (approval.version !== target.version || approval.contentHash !== target.contentHash || approval.scope !== target.scope) return false;
  return !approval.expiresAt || new Date(approval.expiresAt) > now;
}

export function isFreshForExport(freshness: FreshnessBinding | undefined): boolean {
  return freshness?.state === "current" || freshness?.state === "not_applicable";
}

export function validateExportObjects(
  objects: Array<{ entityId: string; entityType: string; version: number; contentHash: string }>,
  approvals: ApprovalBinding[],
  freshness: FreshnessBinding[]
): { ok: true } | { ok: false; reasons: string[] } {
  const reasons = objects.flatMap((object) => {
    const matchingApproval = approvals.find((approval) => approvalMatches(approval, { ...object, scope: "relationship_export" }));
    const matchingFreshness = freshness.find((item) => item.entityId === object.entityId && item.entityType === object.entityType && item.version === object.version);
    const objectReasons: string[] = [];
    if (!matchingApproval) objectReasons.push(`${object.entityType}:${object.entityId} lacks exact export approval`);
    if (!isFreshForExport(matchingFreshness)) objectReasons.push(`${object.entityType}:${object.entityId} is not current`);
    return objectReasons;
  });
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

export function canEnrich(input: z.infer<typeof enrichmentCommandSchema>): { ok: true } | { ok: false; reason: string } {
  const parsed = enrichmentCommandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "PERSON_APPROVAL_REQUIRED" };
  if (parsed.data.estimatedCredits > parsed.data.approvedCreditCap) return { ok: false, reason: "PROVIDER_BUDGET_EXCEEDED" };
  return { ok: true };
}

export function canApproveProspect(conflict: string, overrideApprovalId?: string | null): boolean {
  return conflict === "clear" || (conflict === "overridden" && Boolean(overrideApprovalId));
}

export function canReleaseAsset(qaResult: string, exactApproval: boolean): boolean {
  return (qaResult === "pass" || qaResult === "conditional_pass") && exactApproval;
}

export function computePriority(parts: { value: number; urgency: number; readiness: number; risk: number; effort: number }): number {
  return parts.value + parts.urgency + parts.readiness - parts.risk - parts.effort;
}

export type DryRun = {
  batchId: string;
  inputHash: string;
  records: unknown[];
};

export function bindDryRun(dryRun: DryRun): DryRun & { dryRunHash: string } {
  return { ...dryRun, dryRunHash: stableHash({ batchId: dryRun.batchId, inputHash: dryRun.inputHash, records: dryRun.records }) };
}

export function commitBindingMatches(
  dryRun: DryRun & { dryRunHash: string },
  approval: { objectId: string; contentHash: string; scope: string }
): boolean {
  return approval.objectId === dryRun.batchId
    && approval.contentHash === dryRun.dryRunHash
    && approval.scope === "relationship_export_commit";
}

export class IdempotencyLedger<T> {
  private readonly entries = new Map<string, T>();

  execute(key: string, operation: () => T): { value: T; duplicate: boolean } {
    const existing = this.entries.get(key);
    if (existing !== undefined) return { value: existing, duplicate: true };
    const value = operation();
    this.entries.set(key, value);
    return { value, duplicate: false };
  }
}
