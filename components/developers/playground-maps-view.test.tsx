import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  MapsResultView,
  formatBytes,
  formatMeters,
  formatSeconds,
  type MapsCallOutcome,
} from "./playground-maps-view"

const noRun = async (): Promise<MapsCallOutcome> => ({ ok: false, error: { message: "not in test" } })
const useInRequest = () => {}
const onCopy = () => {}

function render(props: {
  json: unknown
  operation: string
  request?: Record<string, unknown>
  runMaps?: typeof noRun
}) {
  return renderToStaticMarkup(
    createElement(MapsResultView, {
      json: typeof props.json === "string" ? props.json : JSON.stringify(props.json, null, 2),
      operation: props.operation,
      requestJson: JSON.stringify({ capability: "maps", operation: props.operation, input: props.request ?? {} }),
      runMaps: props.runMaps ?? noRun,
      useInRequest,
      onCopy,
    }),
  )
}

describe("maps unit formats", () => {
  it("humanises distances, durations and byte sizes", () => {
    expect(formatMeters(840)).toBe("840 m")
    expect(formatMeters(8400)).toBe("8.4 km")
    expect(formatMeters(45_200)).toBe("45 km")
    expect(formatMeters(null)).toBe("—")
    expect(formatSeconds(45)).toBe("45 s")
    expect(formatSeconds(730)).toBe("12 min")
    expect(formatSeconds(4500)).toBe("1 h 15 min")
    expect(formatBytes(900)).toBe("900 B")
    expect(formatBytes(43_903)).toBe("43 KB")
  })
})

describe("MapsResultView — geocoding family", () => {
  const places = {
    results: [
      {
        id: "dXJuOm1ieHBsYzpFUVRx",
        name: "Kampala",
        formattedAddress: "Kampala, Central Region, Uganda",
        longitude: 32.5725,
        latitude: 0.3175,
      },
      { id: "poi.2", name: "Java House", longitude: 32.58, latitude: 0.31 },
    ],
  }

  it("renders place cards with address, coordinates and follow-up actions", () => {
    const html = render({ json: places, operation: "geocode" })
    expect(html).toContain("2 places")
    expect(html).toContain("Kampala, Central Region, Uganda")
    expect(html).toContain("32.5725, 0.3175")
    expect(html).toContain("Show on map")
    expect(html).toContain("Look up details")
    // The second result has no address — disclosed, never blank or "null".
    expect(html).toContain("no address returned")
    // The map panel starts unrendered: loading one costs credits.
    expect(html).toContain("Load map")
    expect(html).toContain("billed like any other runtime call")
  })

  it("keeps the provider token and raw JSON out of the formatted view", () => {
    const html = render({ json: places, operation: "search" })
    expect(html).not.toContain("access_token")
    expect(html).not.toContain("&quot;results&quot;")
  })
})

describe("MapsResultView — routing", () => {
  it("summarises routes and offers the geometry as a drawn line", () => {
    const html = render({
      json: {
        operation: "directions",
        payload: {
          code: "Ok",
          routes: [
            {
              distance: 8400,
              duration: 1500,
              geometry: {
                type: "LineString",
                coordinates: [
                  [32.5825, 0.3175],
                  [32.52, 0.2],
                  [32.4615, 0.0532],
                ],
              },
              legs: [{ distance: 8400, duration: 1500, summary: "" }],
            },
          ],
        },
      },
      operation: "directions",
    })
    expect(html).toContain("Primary route")
    expect(html).toContain("8.4 km")
    expect(html).toContain("25 min")
    expect(html).toContain("1 leg")
    expect(html).not.toContain("no GeoJSON geometry")
  })

  it("says so when a route cannot be drawn", () => {
    const html = render({
      json: { operation: "directions", payload: { code: "Ok", routes: [{ distance: 8400, duration: 1500 }] } },
      operation: "directions",
    })
    expect(html).toContain("no GeoJSON geometry")
    expect(html).toContain("geometries=geojson")
  })

  it("labels isochrone contours by reachable minutes", () => {
    const ring = [
      [32.58, 0.31],
      [32.59, 0.31],
      [32.59, 0.32],
      [32.58, 0.32],
    ]
    const html = render({
      json: {
        operation: "isochrone",
        payload: {
          type: "FeatureCollection",
          features: [
            { properties: { contour_minutes: 10 }, geometry: { type: "Polygon", coordinates: [ring] } },
            { properties: { contour_minutes: 20 }, geometry: { type: "Polygon", coordinates: [ring] } },
          ],
        },
      },
      operation: "isochrone",
    })
    expect(html).toContain("2 reachable zones")
    expect(html).toContain("10 min reach")
    expect(html).toContain("4 ring points")
    expect(html).toContain("Outline on map")
  })

  it("reads a matrix as per-origin travel cards, not a grid", () => {
    const html = render({
      json: {
        operation: "matrix",
        payload: {
          code: "Ok",
          durations: [
            [0, 730, null],
            [730, 0, 400],
          ],
          distances: [
            [0, 8400, null],
            [8400, 0, 4100],
          ],
        },
      },
      operation: "matrix",
    })
    expect(html).toContain("2 origins")
    expect(html).toContain("From point 1")
    expect(html).toContain("12 min · 8.4 km")
    expect(html).toContain("no route")
    expect(html).not.toContain("<table")
  })
})

describe("MapsResultView — provider payloads", () => {
  it("renders the static image that came back", () => {
    const html = render({
      json: {
        operation: "staticImage",
        payload: {
          contentType: "image/png",
          byteLength: 43_903,
          reachable: true,
          dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        },
      },
      operation: "staticImage",
      request: { longitude: 32.58, latitude: 0.31, zoom: 11, marker: true },
    })
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="')
    expect(html).toContain("43 KB")
    expect(html).toContain("Adjust and re-render")
  })

  it("reports tile reachability against the tileset that was asked for", () => {
    const html = render({
      json: {
        operation: "tilesMetadata",
        payload: { contentType: "application/x-protobuf", byteLength: 21_000, reachable: true },
      },
      operation: "tilesMetadata",
      request: { tilesetId: "mapbox.mapbox-streets-v8", z: 12, x: 2292, y: 1836 },
    })
    expect(html).toContain("Tile endpoint reachable")
    expect(html).toContain("mapbox.mapbox-streets-v8")
    expect(html).toContain("12/2292/1836")
    expect(html).toContain("21 KB")
  })

  it("breaks a style down by layer type and offers a preview", () => {
    const html = render({
      json: {
        operation: "styleSchema",
        payload: {
          version: 8,
          name: "Streets",
          sources: { composite: { type: "vector" } },
          layers: [
            { id: "bg", type: "background" },
            { id: "road", type: "line" },
            { id: "label", type: "symbol" },
            { id: "road2", type: "line" },
          ],
        },
      },
      operation: "styleSchema",
      request: { username: "mapbox", styleId: "streets-v12" },
    })
    expect(html).toContain("Streets")
    expect(html).toContain("4 layers")
    expect(html).toContain("line ×2")
    expect(html).toContain("mapbox/streets-v12 as rendered")
  })

  it("falls back to the generic viewer for an unmapped shape", () => {
    const html = render({ json: { unexpected: true }, operation: "tokens" })
    expect(html).toContain("unexpected")
  })

  it("does not crash on a body that is not JSON", () => {
    expect(render({ json: "<html>nope</html>", operation: "geocode" })).toContain("not valid JSON")
  })
})
