import { it, expect } from "vitest";
import {
  permissionsFor,
  requirePermission,
  assertRecentPassword,
} from "../../apps/api/src/access/policy.js";
import {
  accessMutationInput,
  directoryQuery,
  bootstrapInput,
} from "@confsys/contracts";
it("fixed explicit grants deny unknown roles, permissions and missing actors", () => {
  expect(permissionsFor([])).toEqual([]);
  expect(permissionsFor(["superadmin", "*"])).toEqual([]);
  expect(permissionsFor(["conference_staff"])).toEqual([
    "accounts.directory.read",
  ]);
  expect(permissionsFor(["conference_admin"])).toEqual([
    "accounts.directory.read",
    "access.roles.manage",
    "accounts.status.manage",
    "accounts.sessions.revoke",
    "security_audit.read",
    "site.draft.read",
    "site.draft.write",
    "site.publish",
    "files.media.manage",
    "registration.configure",
    "registration.manage",
    "submissions.manage",
    "submissions.read_all",
  ]);
  for (const roles of [undefined, [], ["conference_staff"]])
    expect(() => requirePermission(roles, "access.roles.manage")).toThrow();
  expect(() =>
    requirePermission(["conference_admin"], "future.manuscripts.read"),
  ).toThrow();
});
it("recent proof is server-bound and excludes future, missing and five-minute boundary", () => {
  const now = new Date();
  assertRecentPassword(new Date(now.getTime() - 299999), now);
  for (const at of [
    null,
    new Date(now.getTime() + 1),
    new Date(now.getTime() - 300000),
  ])
    expect(() => assertRecentPassword(at, now)).toThrow();
});
it("strict management contracts reject mass assignment, future roles and unbounded enumeration", () => {
  for (const input of [
    { action: "grant", role: "superadmin", reason: "test" },
    { action: "disable", reason: "test", verified: true },
    { action: "restore", reason: "test", roles: [] },
    { action: "grant", role: "conference_admin", reason: "test", system: true },
  ])
    expect(accessMutationInput.safeParse(input).success).toBe(false);
  expect(directoryQuery.safeParse({ limit: 51 }).success).toBe(false);
  expect(directoryQuery.safeParse({ sort: "password_hash" }).success).toBe(
    false,
  );
  expect(
    bootstrapInput.safeParse({ targetId: "unknown", force: true }).success,
  ).toBe(false);
});
