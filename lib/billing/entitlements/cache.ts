/**
 * Atai — Entitlement cache abstraction (Phase 3, ADR-8).
 *
 * The original Phase 3 foundation used a bare `Map` as a 60s cache. That is a
 * single point of failure per the reviewer's Issue 6: a stale cache could keep
 * serving entitlements after cancellation, and there was no abstraction that
 * could be backed by Redis if/when infra supports it.
 *
 * This module defines the contract (`EntitlementCache`) and a default
 * in-memory implementation. ADR-8 rules:
 *  - Invalidation is event-driven (webhooks, grants, downgrades call it).
 *  - Security-sensitive ops bypass the cache with a fresh read.
 *  - Failure must NEVER open to a permissive state (see service.ts fallback).
 *
 * @module lib/billing/entitlements/cache
 */

import type { EntitlementSet } from "./types"

export interface EntitlementCache {
  /** Return a cached set, or undefined if absent/expired. */
  get(key: string): EntitlementSet | undefined
  /** Store a freshly resolved set. */
  set(key: string, set: EntitlementSet): void
  /** Drop a single key (lifecycle event happened). */
  invalidate(key: string): void
  /** Drop everything (emergency / test teardown). */
  invalidateAll(): void
}

interface Entry {
  set: EntitlementSet
  expires: number
}

/** Default implementation. TTL kept short (≤60s) per ADR-8. */
export class InMemoryEntitlementCache implements EntitlementCache {
  private store = new Map<string, Entry>()
  constructor(private readonly ttlMs: number = 60_000) {}

  get(key: string): EntitlementSet | undefined {
    const hit = this.store.get(key)
    if (!hit) return undefined
    if (hit.expires <= Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return hit.set
  }

  set(key: string, set: EntitlementSet): void {
    this.store.set(key, { set, expires: Date.now() + this.ttlMs })
  }

  invalidate(key: string): void {
    this.store.delete(key)
  }

  invalidateAll(): void {
    this.store.clear()
  }
}

/**
 * Process-wide singleton. Swap for a Redis-backed implementation here ONLY if
 * existing infrastructure provides one — do not assume Redis exists. The
 * interface is the contract; nothing else in the module depends on the impl.
 */
export const entitlementCache: EntitlementCache = new InMemoryEntitlementCache()
