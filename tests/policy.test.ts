import { describe, expect, it, vi } from "vitest";
import { approvalMatches, bindDryRun, canApproveProspect, canEnrich, canReleaseAsset, commitBindingMatches, computePriority, IdempotencyLedger, isFreshForExport, validateExportObjects } from "../src/policy.js";

const hash = `sha256:${"a".repeat(64)}`;

describe("validated application policy", () => {
  it("binds approval to exact identity, version, hash and scope", () => {
    const approval = { entityId: "entity-1", entityType: "company", version: 2, contentHash: hash, scope: "fixture_display", decision: "approved" as const };
    expect(approvalMatches(approval, { entityId: "entity-1", entityType: "company", version: 2, contentHash: hash, scope: "fixture_display" })).toBe(true);
    expect(approvalMatches(approval, { entityId: "entity-1", entityType: "company", version: 3, contentHash: hash, scope: "fixture_display" })).toBe(false);
    expect(approvalMatches(approval, { entityId: "entity-1", entityType: "company", version: 2, contentHash: `sha256:${"b".repeat(64)}`, scope: "fixture_display" })).toBe(false);
  });

  it("treats freshness independently and blocks stale export", () => {
    expect(isFreshForExport({ entityId: "1", entityType: "claim", version: 1, state: "stale" })).toBe(false);
    const result = validateExportObjects([{ entityId: "1", entityType: "claim", version: 1, contentHash: hash }], [{ entityId: "1", entityType: "claim", version: 1, contentHash: hash, scope: "relationship_export", decision: "approved" }], [{ entityId: "1", entityType: "claim", version: 1, state: "stale" }]);
    expect(result).toEqual({ ok: false, reasons: ["claim:1 is not current"] });
  });

  it("requires exact person approval and a sufficient provider budget", () => {
    expect(canEnrich({ personId: "p1", personVersion: 1, personApproval: "approved", provider: "apollo", estimatedCredits: 2, approvedCreditCap: 0 })).toEqual({ ok: false, reason: "PROVIDER_BUDGET_EXCEEDED" });
    expect(canEnrich({ personId: "p1", personVersion: 1, personApproval: "approved", provider: "apollo", estimatedCredits: 2, approvedCreditCap: 2 })).toEqual({ ok: true });
  });

  it("blocks known-customer prospects without a recorded override", () => {
    expect(canApproveProspect("current_customer")).toBe(false);
    expect(canApproveProspect("overridden", "approval-1")).toBe(true);
  });

  it("requires independent QA plus exact approval for asset release", () => {
    expect(canReleaseAsset("conditional_pass", true)).toBe(true);
    expect(canReleaseAsset("conditional_pass", false)).toBe(false);
    expect(canReleaseAsset("fail", true)).toBe(false);
  });

  it("binds commits to the exact dry-run batch and hash", () => {
    const dryRun = bindDryRun({ batchId: "batch-1", inputHash: hash, records: [{ id: 1 }] });
    expect(commitBindingMatches(dryRun, { objectId: "batch-1", contentHash: dryRun.dryRunHash, scope: "relationship_export_commit" })).toBe(true);
    expect(commitBindingMatches(dryRun, { objectId: "batch-2", contentHash: dryRun.dryRunHash, scope: "relationship_export_commit" })).toBe(false);
  });

  it("enforces run idempotency", () => {
    const operation = vi.fn(() => ({ state: "done" }));
    const ledger = new IdempotencyLedger<{ state: string }>();
    expect(ledger.execute("run:one", operation).duplicate).toBe(false);
    expect(ledger.execute("run:one", operation).duplicate).toBe(true);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("uses the documented deterministic priority formula", () => {
    expect(computePriority({ value: 35, urgency: 25, readiness: 25, risk: 8, effort: 4 })).toBe(73);
  });
});
