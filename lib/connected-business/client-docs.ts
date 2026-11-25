import type { BusinessDoc, BusinessMemberDoc, ConnectedApplicationDoc } from "@/lib/types/business"

/**
 * Make a Mongo document safe to hand to a Client Component.
 *
 * The driver returns `_id` as a BSON `ObjectId`. React currently serialises it
 * through `toJSON()` to a hex string, so it happens to cross the boundary — but
 * it logs "Objects with toJSON methods are not supported" in development, and
 * relying on that special case is fragile. Nothing in this app reads a business
 * document's `_id` (authorisation and lookups use `id`), so dropping it at the
 * boundary is lossless and leaves only plain data on the wire.
 *
 * @module lib/connected-business/client-docs
 */

export type ClientBusiness = Omit<BusinessDoc, "_id">
export type ClientApplication = Omit<ConnectedApplicationDoc, "_id">
export type ClientMember = Omit<BusinessMemberDoc, "_id">

export function withoutMongoId<T extends { _id?: unknown }>(doc: T): Omit<T, "_id"> {
  const { _id: _ignored, ...rest } = doc
  void _ignored
  return rest
}
