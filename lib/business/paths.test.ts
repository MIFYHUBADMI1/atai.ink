import { describe, expect, it } from "vitest"
import { PathInputError, applicationOrigin, canonicalBasePath } from "./paths"

describe("canonicalBasePath", () => {
  it("treats every root form as the origin root", () => {
    for (const input of ["", "/", "//", "   ", null, undefined]) {
      expect(canonicalBasePath(input)).toBe("")
    }
  })

  it("removes trailing and duplicate slashes", () => {
    expect(canonicalBasePath("/shop/")).toBe("/shop")
    expect(canonicalBasePath("//shop//x//")).toBe("/shop/x")
  })

  it("adds a missing leading slash", () => {
    expect(canonicalBasePath("shop")).toBe("/shop")
  })

  it("normalises percent-encoding so one path has one identity", () => {
    expect(canonicalBasePath("/%73hop")).toBe("/shop")
    expect(canonicalBasePath("/café")).toBe("/caf%C3%A9")
    expect(canonicalBasePath("/caf%C3%A9")).toBe("/caf%C3%A9")
  })

  it("is idempotent", () => {
    for (const input of ["", "/", "/shop/", "//a//b//", "/caf%C3%A9", "/a%20b"]) {
      const once = canonicalBasePath(input)
      expect(canonicalBasePath(once)).toBe(once)
    }
  })

  it("preserves case, because HTTP paths are case-sensitive", () => {
    expect(canonicalBasePath("/Shop")).toBe("/Shop")
    expect(canonicalBasePath("/Shop")).not.toBe(canonicalBasePath("/shop"))
  })

  it("rejects a path that means more than one thing", () => {
    expect(() => canonicalBasePath("/a/../b")).toThrow(PathInputError)
    expect(() => canonicalBasePath("/a%2Fb")).toThrow(PathInputError)
    expect(() => canonicalBasePath("/shop?x=1")).toThrow(PathInputError)
    expect(() => canonicalBasePath("/shop#top")).toThrow(PathInputError)
    expect(() => canonicalBasePath("/a\\b")).toThrow(PathInputError)
    expect(() => canonicalBasePath("/%")).toThrow(PathInputError)
  })

  it("rejects an over-long path", () => {
    expect(() => canonicalBasePath(`/${"a".repeat(201)}`)).toThrow(PathInputError)
  })

  it("formats an application address for display", () => {
    expect(applicationOrigin({ hostname: "example.com", basePath: "" })).toBe("example.com")
    expect(applicationOrigin({ hostname: "example.com", basePath: "/shop" })).toBe("example.com/shop")
  })
})
