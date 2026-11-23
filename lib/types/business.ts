import type { ObjectId } from "mongodb"

/**
 * Connected-business entities (ADR-8).
 *
 * A business is the company. A connected application is one of its digital
 * assets. A project is an application Atai builds, and is a different thing —
 * these types never describe a project.
 *
 * @module lib/types/business
 */

export const BUSINESS_STATUSES = ["draft", "active", "suspended", "archived"] as const
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number]

export const BUSINESS_ROLES = ["owner", "admin", "marketer", "developer", "finance", "viewer"] as const
export type BusinessRole = (typeof BUSINESS_ROLES)[number]

export const APPLICATION_KINDS = [
  "marketing_site",
  "saas_app",
  "customer_portal",
  "storefront",
  "mobile_backend",
  "other",
] as const
export type ApplicationKind = (typeof APPLICATION_KINDS)[number]

export type MemberStatus = "active" | "invited" | "removed"

/** Which applications a member may act on. `all` is the default. */
export type MemberScope = { kind: "all" } | { kind: "applications"; applicationIds: string[] }

export type SuggestedNameSource = "website_title" | "hostname" | "founder"

/**
 * Set only on rows a migration run created. Rollback refuses to delete any row
 * without it, and refuses to delete a row that no longer matches what the run
 * wrote — a record touched after migration is not migration-owned any more.
 */
export interface MigrationStamp {
  id: string
  runId: string
  createdAt: number
}

/** Evidence that the customer's own application talks to Atai. Derived on read. */
export interface ApplicationConnection {
  firstSeenAt?: number
  lastSeenAt?: number
  seenCalls?: number
  revokedAt?: number
}

export interface BusinessDoc {
  _id?: ObjectId
  id: string
  /** Lookup and billing only. Authorisation always goes through business_members. */
  ownerId: string
  name: string
  suggestedName?: string
  suggestedNameSource?: SuggestedNameSource
  status: BusinessStatus
  /** Set only by the migration for a project that predates this model. */
  legacyProjectId?: string
  migration?: MigrationStamp
  schemaVersion: number
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export interface ConnectedApplicationDoc {
  _id?: ObjectId
  id: string
  businessId: string
  name: string
  kind: ApplicationKind
  primaryUrl: string
  /** Lowercased, IDNA-punycoded, no port. */
  hostname: string
  /** Canonical path prefix: "" for the origin root, otherwise "/shop". */
  basePath: string
  /**
   * Every application on one hostname shares this value. Same-origin
   * applications share a trust domain: a key for one is only as safe as the
   * server that also holds the other. Path scoping is organisational, never a
   * security boundary.
   */
  trustDomain: string
  hostVerified: boolean
  connection: ApplicationConnection
  legacyProjectId?: string
  migration?: MigrationStamp
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export interface BusinessMemberDoc {
  _id?: ObjectId
  id: string
  businessId: string
  userId: string
  role: BusinessRole
  status: MemberStatus
  scope: MemberScope
  invitedBy?: string
  /** Who restored a removed member, and when. Never set on first creation. */
  reactivatedBy?: string
  reactivatedAt?: number
  migration?: MigrationStamp
  createdAt: number
  updatedAt: number
}

export const BUSINESS_SCHEMA_VERSION = 1
