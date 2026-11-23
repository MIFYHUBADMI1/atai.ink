import { describe, expect, it } from "vitest"
import { BUSINESS_ROLES } from "@/lib/types/business"
import {
  ALL_PERMISSIONS,
  READ_PERMISSIONS,
  ROLE_PERMISSIONS,
  SYSTEM_PERMISSIONS,
  isWritePermission,
  roleHasPermission,
} from "./permissions"

describe("role → permission matrix", () => {
  it("covers every role", () => {
    for (const role of BUSINESS_ROLES) expect(ROLE_PERMISSIONS[role]).toBeInstanceOf(Set)
  })

  it("grants the owner everything", () => {
    for (const permission of ALL_PERMISSIONS) expect(roleHasPermission("owner", permission)).toBe(true)
  })

  it("gives every permission to at least one role", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(BUSINESS_ROLES.some((role) => roleHasPermission(role, permission))).toBe(true)
    }
  })

  it("reserves billing changes for the owner", () => {
    expect(roleHasPermission("owner", "money.manage")).toBe(true)
    expect(roleHasPermission("admin", "money.manage")).toBe(false)
    expect(roleHasPermission("admin", "members.manage")).toBe(true)
  })

  it("keeps the viewer read-only", () => {
    for (const permission of ROLE_PERMISSIONS.viewer) {
      expect(READ_PERMISSIONS.has(permission)).toBe(true)
    }
  })

  it("does not let a marketer manage apps, keys, members or money", () => {
    expect(roleHasPermission("marketer", "apps.manage")).toBe(false)
    expect(roleHasPermission("marketer", "runtime.keys.manage")).toBe(false)
    expect(roleHasPermission("marketer", "members.manage")).toBe(false)
    expect(roleHasPermission("marketer", "money.read")).toBe(false)
    expect(roleHasPermission("marketer", "growth.publish")).toBe(true)
  })

  it("does not let a developer publish marketing or read money", () => {
    expect(roleHasPermission("developer", "growth.publish")).toBe(false)
    expect(roleHasPermission("developer", "money.read")).toBe(false)
    expect(roleHasPermission("developer", "integrations.manage")).toBe(true)
    expect(roleHasPermission("developer", "runtime.keys.manage")).toBe(true)
  })

  it("does not let finance publish growth", () => {
    expect(roleHasPermission("finance", "money.read")).toBe(true)
    expect(roleHasPermission("finance", "growth.publish")).toBe(false)
  })

  it("separates observation from change", () => {
    expect(isWritePermission("business.read")).toBe(false)
    expect(isWritePermission("analytics.read")).toBe(false)
    expect(isWritePermission("growth.publish")).toBe(true)
    expect(isWritePermission("members.manage")).toBe(true)
  })

  it("grants a system actor no business-scoped permission", () => {
    expect([...SYSTEM_PERMISSIONS]).toEqual([])
  })
})
