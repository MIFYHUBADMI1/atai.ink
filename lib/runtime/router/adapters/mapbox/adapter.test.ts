import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProviderExecutionRequest } from "@/runtime/contracts/router"

// Same stubs the runtime router tests use — server-only and logging are
// environment concerns, not what these tests exercise.
vi.mock("server-only", () => ({}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const TOKEN_ENV = "MAPBOX_ACCESS_TOKEN"

function makeRequest(
  operation: string,
  input: unknown,
  metadata?: Record<string, unknown>,
): ProviderExecutionRequest {
  return {
    auth: {
      apiKeyId: "key_test",
      userId: "user_test",
      projectId: "proj_test",
      environment: "development",
      scopes: ["maps"],
    },
    requestId: "rtreq_test_1",
    request: { capability: "maps", operation, input, ...(metadata ? { metadata } : {}) },
  }
}

let capturedUrl = ""
let capturedMethod = ""

function mockFetch(
  body: BodyInit,
  status = 200,
  contentType = "application/json",
) {
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    capturedUrl = String(url)
    capturedMethod = String(init?.method ?? "GET")
    return new Response(body, { status, headers: { "content-type": contentType } })
  })
  globalThis.fetch = fn as typeof fetch
  return fn
}

function mockFetchJson(body: unknown, status = 200) {
  return mockFetch(JSON.stringify(body), status)
}

/** Capture the raw fetch URL of the last executed call. */
function lastUrl(): URL {
  return new URL(capturedUrl)
}

async function runAdapter(request: ProviderExecutionRequest) {
  const { mapboxAdapter } = await import("./adapter")
  return mapboxAdapter.execute(request)
}

/**
 * Geocoding v6 shape, verified against live payloads: descriptive fields live
 * under `feature.properties`, and the reusable id is `properties.mapbox_id`
 * (which contains `:` and can far exceed 64 characters).
 */
const GEOCODE_RESPONSE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "place.593903013",
      geometry: { type: "Point", coordinates: [32.5725, 0.3175] },
      properties: {
        mapbox_id: "dXJuOm1ieHBsYzpFUVRx",
        name: "Kampala",
        name_preferred: "Kampala",
        full_address: "Kampala, Central Region, Uganda",
        place_formatted: "Kampala",
        coordinates: { longitude: 32.5725, latitude: 0.3175 },
      },
    },
  ],
}

beforeEach(() => {
  capturedUrl = ""
  capturedMethod = ""
  process.env[TOKEN_ENV] = "pk.test-token-not-real"
})

afterEach(() => {
  delete process.env[TOKEN_ENV]
  vi.resetModules()
})

describe("MapboxAdapter — operation coverage", () => {
  // First dynamic import in the file pays the cold module-graph transform;
  // under parallel workers that alone can exceed the 5s default.
  it("supports every maps operation the contract now registers", async () => {
    const { mapboxAdapter } = await import("./adapter")
    for (const op of [
      "geocode",
      "reverseGeocode",
      "search",
      "placeDetails",
      "isochrone",
      "directions",
      "matrix",
      "tilesMetadata",
      "styleSchema",
      "staticImage",
    ]) {
      expect(mapboxAdapter.supports("maps", op)).toBe(true)
    }
    expect(mapboxAdapter.supports("maps", "deleteEverything")).toBe(false)
    expect(mapboxAdapter.supports("db", "geocode")).toBe(false)
  }, 30_000)

  it("does not serve the Tokens API — a public-scope token 404s there", async () => {
    const { mapboxAdapter } = await import("./adapter")
    expect(mapboxAdapter.supports("maps", "tokens")).toBe(false)
  })
})

describe("MapboxAdapter — endpoint translation", () => {
  it("geocode uses the v6 forward endpoint and normalizes properties into results", async () => {
    mockFetchJson(GEOCODE_RESPONSE)
    const result = await runAdapter(makeRequest("geocode", { query: "Kampala", limit: 3 }))
    const url = lastUrl()
    expect(url.pathname).toBe("/search/geocode/v6/forward")
    expect(url.searchParams.get("q")).toBe("Kampala")
    expect(url.searchParams.get("limit")).toBe("3")
    expect(url.searchParams.get("access_token")).toBe("pk.test-token-not-real")
    expect(result.data).toEqual({
      results: [
        {
          id: "dXJuOm1ieHBsYzpFUVRx",
          name: "Kampala",
          formattedAddress: "Kampala, Central Region, Uganda",
          longitude: 32.5725,
          latitude: 0.3175,
        },
      ],
    })
  })

  it("reverseGeocode uses the v6 reverse endpoint with longitude/latitude query", async () => {
    mockFetchJson(GEOCODE_RESPONSE)
    await runAdapter(makeRequest("reverseGeocode", { longitude: 32.5725, latitude: 0.3175, limit: 2 }))
    const url = lastUrl()
    expect(url.pathname).toBe("/search/geocode/v6/reverse")
    expect(url.searchParams.get("longitude")).toBe("32.5725")
    expect(url.searchParams.get("latitude")).toBe("0.3175")
    expect(url.searchParams.get("limit")).toBe("2")
  })

  it("search uses Search Box forward and biases with proximity, not ars", async () => {
    mockFetchJson(GEOCODE_RESPONSE)
    await runAdapter(
      makeRequest("search", {
        query: "coffee",
        longitude: 32.58,
        latitude: 0.31,
        types: ["poi", "place"],
        country: "ug",
      }),
    )
    const url = lastUrl()
    expect(url.pathname).toBe("/search/searchbox/v1/forward")
    expect(url.searchParams.get("proximity")).toBe("32.58,0.31")
    expect(url.searchParams.get("ars")).toBeNull()
    expect(url.searchParams.get("types")).toBe("poi,place")
    expect(url.searchParams.get("country")).toBe("ug")
  })

  it("placeDetails retrieves by mapbox_id and mints a session token", async () => {
    mockFetchJson(GEOCODE_RESPONSE)
    await runAdapter(makeRequest("placeDetails", { poiId: "dXJuOm1ieHBsYzpFUVRx" }))
    const url = lastUrl()
    expect(url.pathname).toBe("/search/searchbox/v1/retrieve/dXJuOm1ieHBsYzpFUVRx")
    // retrieve refuses the call without one; the contract has no autocomplete
    // session, so the adapter generates it.
    expect(url.searchParams.get("session_token")).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("placeDetails honours a caller-supplied session token", async () => {
    mockFetchJson(GEOCODE_RESPONSE)
    await runAdapter(
      makeRequest("placeDetails", { poiId: "a.1", sessionToken: "session-from-suggest-1" }),
    )
    expect(lastUrl().searchParams.get("session_token")).toBe("session-from-suggest-1")
  })

  it("isochrone paths the profile as mapbox/{profile}", async () => {
    mockFetchJson({ type: "FeatureCollection", features: [] })
    await runAdapter(
      makeRequest("isochrone", { coordinates: [32.58, 0.31], profile: "driving", minutes: [10, 20] }),
    )
    const url = lastUrl()
    expect(url.pathname).toBe("/isochrone/v1/mapbox/driving/32.58,0.31")
    expect(url.searchParams.get("contours_minutes")).toBe("10,20")
  })

  it("isochrone falls back to the default contour set", async () => {
    mockFetchJson({ type: "FeatureCollection", features: [] })
    await runAdapter(makeRequest("isochrone", { coordinates: [32.58, 0.31] }))
    const url = lastUrl()
    expect(url.pathname).toBe("/isochrone/v1/mapbox/driving/32.58,0.31")
    expect(url.searchParams.get("contours_minutes")).toBe("10,20,30")
  })

  it("directions joins waypoints into the path and keeps coordinates out of query", async () => {
    mockFetchJson({ code: "Ok", routes: [] })
    await runAdapter(
      makeRequest("directions", {
        coordinates: [
          [32.58, 0.31],
          [32.57, 0.34],
        ],
        profile: "cycling",
      }),
    )
    const url = lastUrl()
    expect(url.pathname).toBe("/directions/v5/mapbox/cycling/32.58,0.31;32.57,0.34")
    expect(url.searchParams.get("coordinates")).toBeNull()
  })

  it("matrix GETs the path-addressed directions-matrix endpoint", async () => {
    mockFetchJson({ code: "Ok", durations: [[0, 12], [12, 0]] })
    const result = await runAdapter(
      makeRequest("matrix", {
        coordinates: [
          [32.58, 0.31],
          [32.57, 0.34],
        ],
        annotations: ["duration", "distance"],
      }),
    )
    const url = lastUrl()
    // The legacy POST /matrix/v1 is retired (403); profile is a path segment.
    expect(capturedMethod).toBe("GET")
    expect(url.pathname).toBe("/directions-matrix/v1/mapbox/driving/32.58,0.31;32.57,0.34")
    expect(url.searchParams.get("profile")).toBeNull()
    expect(url.searchParams.get("coordinates")).toBeNull()
    expect(url.searchParams.get("annotations")).toBe("duration,distance")
    expect(result.data).toEqual({
      operation: "matrix",
      payload: { code: "Ok", durations: [[0, 12], [12, 0]] },
    })
  })

  it("styleSchema fetches the style JSON and passes the payload through as diagnostics", async () => {
    const style = { version: 8, name: "Streets", layers: [] }
    mockFetchJson(style)
    const result = await runAdapter(makeRequest("styleSchema", { username: "mapbox", styleId: "streets-v12" }))
    expect(lastUrl().pathname).toBe("/styles/v1/mapbox/streets-v12")
    expect(result.data).toEqual({ operation: "styleSchema", payload: style })
  })

  it("staticImage puts the marker overlay before the position", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 10, 26])
    mockFetch(png, 200, "image/png")
    const result = await runAdapter(
      makeRequest("staticImage", { longitude: 32.58, latitude: 0.31, zoom: 11, width: 600, height: 400, marker: true }),
    )
    // Live-verified overlay grammar: pin-{s|m|l}+{rrggbb}(lng,lat), before the
    // position. An overlay after the position 404s.
    expect(lastUrl().pathname).toBe(
      "/styles/v1/mapbox/streets-v12/static/pin-m+0f6bd3(32.58000,0.31000)/32.58,0.31,11/600x400",
    )
    const payload = (result.data as { payload: Record<string, unknown> }).payload
    expect(payload.byteLength).toBe(png.byteLength)
    expect(String(payload.dataUrl).startsWith("data:image/png;base64,")).toBe(true)
  })

  it("staticImage draws a polyline and frames it with auto", async () => {
    mockFetch(new Uint8Array([1]), 200, "image/png")
    await runAdapter(
      makeRequest("staticImage", {
        path: [
          [32.5825, 0.3175],
          [32.52, 0.2],
          [32.4615, 0.0532],
        ],
        fit: true,
        retina: true,
        pathWidth: 8,
        pathColor: "ff7f00",
      }),
    )
    const url = lastUrl()
    expect(url.pathname).toBe(
      "/styles/v1/mapbox/streets-v12/static/path-8+ff7f00(32.58250,0.31750,32.52000,0.20000,32.46150,0.05320)/auto/600x400@2x",
    )
  })

  it("staticImage thins long polylines instead of overflowing the URL", async () => {
    mockFetch(new Uint8Array([1]), 200, "image/png")
    await runAdapter(
      makeRequest("staticImage", {
        path: Array.from({ length: 600 }, (_, i) => [32.46 + i * 0.0002, 0.05 + i * 0.0004]),
        fit: true,
      }),
    )
    const pathname = lastUrl().pathname
    const overlay = pathname.match(/path-6\+00b0ff\(([^)]+)\)/)?.[1] ?? ""
    const pointCount = overlay.split(",").length / 2
    expect(pointCount).toBeLessThanOrEqual(200)
    // The tail of the route must survive thinning, or the drawn line lies.
    expect(overlay.endsWith("32.57980,0.28960")).toBe(true)
  })

  it("staticImage rejects two overlays — Mapbox renders only one", async () => {
    mockFetch(new Uint8Array([1]), 200, "image/png")
    await expect(
      runAdapter(
        makeRequest("staticImage", {
          longitude: 32.58,
          latitude: 0.31,
          marker: true,
          path: [
            [32.58, 0.31],
            [32.46, 0.05],
          ],
        }),
      ),
    ).rejects.toMatchObject({ category: "unsupported_operation" })
  })

  it("staticImage rejects a pin with no centre", async () => {
    mockFetch(new Uint8Array([1]), 200, "image/png")
    await expect(runAdapter(makeRequest("staticImage", { marker: true, fit: true }))).rejects.toMatchObject({
      category: "unsupported_operation",
    })
  })

  it("staticImage rejects non-hex overlay colours", async () => {
    mockFetch(new Uint8Array([1]), 200, "image/png")
    await expect(
      runAdapter(makeRequest("staticImage", { longitude: 1, latitude: 1, markerColor: "#ff0000" })),
    ).rejects.toMatchObject({ category: "unsupported_operation" })
  })

  it("directions asks for GeoJSON geometry so routes can be drawn", async () => {
    mockFetchJson({ code: "Ok", routes: [] })
    await runAdapter(
      makeRequest("directions", {
        coordinates: [
          [32.58, 0.31],
          [32.46, 0.05],
        ],
      }),
    )
    expect(lastUrl().searchParams.get("geometries")).toBe("geojson")
  })

  it("tilesMetadata fetches the tile binary and reports reachability metadata", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    mockFetch(bytes, 200, "application/x-protobuf")
    const result = await runAdapter(
      makeRequest("tilesMetadata", { tilesetId: "mapbox.mapbox-streets-v8", z: 12, x: 2292, y: 1836 }),
    )
    expect(lastUrl().pathname).toBe("/v4/mapbox.mapbox-streets-v8/12/2292/1836.mvt")
    expect(result.data).toEqual({
      operation: "tilesMetadata",
      payload: { contentType: "application/x-protobuf", byteLength: 4, reachable: true },
    })
  })
})

describe("MapboxAdapter — response normalization", () => {
  it("accepts a long colon-bearing mapbox_id from Search Box features", async () => {
    const longId = `dXJuOm1ieHBsYjp${"Z".repeat(300)}`
    mockFetchJson({
      features: [
        {
          properties: {
            mapbox_id: longId,
            name_preferred: "Java House",
            place_formatted: "Kyadondo Rd, Kampala",
            coordinates: { longitude: 32.58, latitude: 0.31 },
          },
        },
      ],
    })
    const result = await runAdapter(makeRequest("search", { query: "Java House" }))
    expect(result.data).toEqual({
      results: [
        { id: longId, name: "Java House", formattedAddress: "Kyadondo Rd, Kampala", longitude: 32.58, latitude: 0.31 },
      ],
    })
  })

  it("falls back to geometry coordinates when properties carry none", async () => {
    mockFetchJson({
      features: [
        {
          properties: { mapbox_id: "poi.1", name: "Garden City" },
          geometry: { type: "Point", coordinates: [32.6, 0.35] },
        },
      ],
    })
    const result = await runAdapter(makeRequest("geocode", { query: "Garden City" }))
    expect(result.data).toEqual({
      results: [{ id: "poi.1", name: "Garden City", longitude: 32.6, latitude: 0.35 }],
    })
  })

  it("drops unusable features instead of emitting empty or partial rows", async () => {
    mockFetchJson({
      features: [
        { properties: { name: "No id", coordinates: { longitude: 1, latitude: 1 } } },
        { properties: { mapbox_id: "poi.2", coordinates: { longitude: 2, latitude: 2 } } },
        { properties: { mapbox_id: "poi.3", name: "Nowhere" } },
        GEOCODE_RESPONSE.features[0],
      ],
    })
    const result = await runAdapter(makeRequest("geocode", { query: "Kampala" }))
    expect(result.data).toEqual({
      results: [
        {
          id: "dXJuOm1ieHBsYzpFUVRx",
          name: "Kampala",
          formattedAddress: "Kampala, Central Region, Uganda",
          longitude: 32.5725,
          latitude: 0.3175,
        },
      ],
    })
  })

  it("reports an invalid provider response when features are absent", async () => {
    mockFetchJson({ code: "Ok" })
    await expect(runAdapter(makeRequest("geocode", { query: "Kampala" }))).rejects.toMatchObject({
      name: "ProviderExecutionError",
      category: "provider_error",
    })
  })

  it("never exposes the access token in the returned data", async () => {
    mockFetchJson(GEOCODE_RESPONSE)
    const result = await runAdapter(makeRequest("geocode", { query: "Kampala" }))
    expect(JSON.stringify(result)).not.toContain("pk.test-token-not-real")
  })

  it("debug metadata attaches the raw provider body for playground diagnostics", async () => {
    mockFetchJson(GEOCODE_RESPONSE)
    const result = await runAdapter(makeRequest("geocode", { query: "Kampala" }, { debug: true }))
    const data = result.data as { results: unknown; raw?: string }
    expect(data.results).toBeInstanceOf(Array)
    expect(data.raw).toContain("Kampala")
  })
})

describe("MapboxAdapter — validation and failure normalization", () => {
  it("rejects unknown input fields (strict schemas, never forwarded)", async () => {
    mockFetchJson({ features: [] })
    await expect(
      runAdapter(makeRequest("search", { query: "x", evil: 1 } as never)),
    ).rejects.toMatchObject({ name: "ProviderExecutionError", category: "unsupported_operation" })
  })

  it("rejects a style id where a tileset id is required", async () => {
    mockFetchJson({ features: [] })
    await expect(
      runAdapter(makeRequest("tilesMetadata", { styleId: "mapbox.streets", z: 12, x: 2292, y: 1836 } as never)),
    ).rejects.toMatchObject({ category: "unsupported_operation" })
  })

  it("rejects out-of-range tile indices for the zoom level", async () => {
    mockFetch(new Uint8Array([1]), 200)
    await expect(
      runAdapter(makeRequest("tilesMetadata", { tilesetId: "mapbox.streets", z: 2, x: 99, y: 0 })),
    ).rejects.toMatchObject({ category: "unsupported_operation" })
  })

  it("rejects malformed coordinate pairs for isochrone", async () => {
    await expect(
      runAdapter(makeRequest("isochrone", { coordinates: [200, 0] })),
    ).rejects.toMatchObject({ category: "unsupported_operation" })
  })

  it("maps provider HTTP failures onto the normalized taxonomy without leaking bodies", async () => {
    mockFetchJson({ message: "Not Authorized" }, 401)
    await expect(runAdapter(makeRequest("geocode", { query: "Kampala" }))).rejects.toMatchObject({
      name: "ProviderExecutionError",
      category: "provider_error",
    })
  })

  it("throws the not-configured sentinel when the token env var is absent", async () => {
    mockFetchJson({ features: [] })
    delete process.env[TOKEN_ENV]
    await expect(runAdapter(makeRequest("geocode", { query: "Kampala" }))).rejects.toMatchObject({
      name: "ProviderNotConfiguredError",
    })
  })

  it("rejects path-injection attempts in style ids", async () => {
    mockFetchJson({ features: [] })
    await expect(
      runAdapter(makeRequest("styleSchema", { username: "mapbox", styleId: "../secrets" })),
    ).rejects.toMatchObject({ category: "unsupported_operation" })
  })

  it("rejects path-injection attempts in mapbox_id", async () => {
    mockFetchJson({ features: [] })
    await expect(
      runAdapter(makeRequest("placeDetails", { poiId: "../secrets" })),
    ).rejects.toMatchObject({ category: "unsupported_operation" })
  })
})
