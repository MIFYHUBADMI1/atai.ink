import type { BusinessRole } from "@/lib/types/business"

/**
 * Business permissions (ADR-8 §6).
 *
 * Permissions are capability-shaped so they map onto both routes and service
 * calls. The role matrix is a code constant, like PLAN_PRICING — not admin data,
 * so a role can never be redefined at runtime.
 *
 * owner differs from admin in exactly one permission: `money.manage`.
 *
 * @module lib/business/permissions
 */

export const ALL_PERMISSIONS = [
  "business.read",
  "business.manage",
  "apps.read",
  "apps.manage",
  "growth.read",
  "growth.publish",
  "analytics.read",
  "content.write",
  "money.read",
  "money.manage",
  "members.manage",
  "integrations.manage",
  "runtime.keys.manage",
] as const

export type Permission = (typeof ALL_PERMISSIONS)[number]

/** Permissions that only observe. Everything else changes something. */
export const READ_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "business.read",
  "apps.read",
  "growth.read",
  "analytics.read",
  "money.read",
])

export function isWritePermission(permission: Permission): boolean {
  return !READ_PERMISSIONS.has(permission)
}

export type Actor = { kind: "user"; id: string } | { kind: "system"; id: string }

export function userActor(id: string): Actor {
  return { kind: "user", id }
}

/** Internal callers only (migration, verification). Never constructed from a request. */
export function systemActor(id: string): Actor {
  return { kind: "system", id }
}

const ROLE_PERMISSION_LISTS: Record<BusinessRole, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter((permission) => permission !== "money.manage"),
  marketer: ["business.read", "apps.read", "growth.read", "growth.publish", "analytics.read", "content.write"],
  developer: [
    "business.read",
    "apps.read",
    "apps.manage",
    "analytics.read",
    "integrations.manage",
    "runtime.keys.manage",
  ],
  finance: ["business.read", "apps.read", "analytics.read", "money.read"],
  viewer: ["business.read", "apps.read", "growth.read", "analytics.read", "money.read"],
}

export const ROLE_PERMISSIONS: Record<BusinessRole, ReadonlySet<Permission>> = {
  owner: new Set(ROLE_PERMISSION_LISTS.owner),
  admin: new Set(ROLE_PERMISSION_LISTS.admin),
  marketer: new Set(ROLE_PERMISSION_LISTS.marketer),
  developer: new Set(ROLE_PERMISSION_LISTS.developer),
  finance: new Set(ROLE_PERMISSION_LISTS.finance),
  viewer: new Set(ROLE_PERMISSION_LISTS.viewer),
}

export function permissionsForRole(role: BusinessRole): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role]
}

export function roleHasPermission(role: BusinessRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission)
}

/**
 * A system actor is not a member. It may run exactly the operations the
 * migration and verification need, and nothing else.
 */
