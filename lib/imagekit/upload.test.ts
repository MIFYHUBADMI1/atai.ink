import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import sharp from "sharp"

vi.mock("@/lib/env", () => ({ getImageKitConfig: () => ({ privateKey: "private-test-key", urlEndpoint: "https://ik.imagekit.io/test" }) }))
vi.mock("@/lib/logging/logger", () => ({ logger: { error: vi.fn() } }))
import { uploadImageToImageKit } from "./upload"

let png: Buffer
const fetchMock = vi.fn()
const valid = { fileId: "img_1", filePath: "/Atai/projects/project/image.png", url: "https://ik.imagekit.io/test/Atai/projects/project/image.png", width: 2, height: 2 }
beforeAll(async () => { png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer() })
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); fetchMock.mockResolvedValue(Response.json(valid)) })
afterEach(() => { vi.unstubAllGlobals() })
const upload = (file = png, mimeType = "image/png") => uploadImageToImageKit({ file, mimeType, fileName: "../../unsafe<script>.gif", folder: "/Atai/projects/project" })

describe("ImageKit upload boundary (mock provider, real decoder)", () => {
  it("publishes reencoded bytes under a safe detected extension without overwrites", async () => {
    await upload(Buffer.concat([png, Buffer.from("<script>payload</script>")]))
    const options = fetchMock.mock.calls[0][1]
    const form = options.body as FormData
    const file = form.get("file") as File
    expect(file.name).toMatch(/^[a-zA-Z0-9_-]+\.png$/)
    expect(file.type).toBe("image/png")
    expect(Buffer.from(await file.arrayBuffer()).includes(Buffer.from("<script>"))).toBe(false)
    expect(form.get("overwriteFile")).toBe("false")
    expect(form.get("useUniqueFileName")).toBe("true")
    expect(form.get("folder")).toBe("/Atai/projects/project")
  })
  it("rejects forged content before any provider request", async () => {
    await expect(upload(Buffer.from("<svg/>"))).rejects.toMatchObject({ code: "IMAGE_UPLOAD_FAILED" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each([
    { url: "http://ik.imagekit.io/test/image.png" },
    { url: "https://other.example/image.png" },
    { url: "https://user:password@ik.imagekit.io/image.png" },
    { filePath: "/Atai/projects/other/image.png" },
    { fileId: 42 },
  ])("rejects untrusted provider metadata %j", async (patch) => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...valid, ...patch }))
    await expect(upload()).rejects.toMatchObject({ code: "IMAGE_UPLOAD_FAILED" })
  })
  it("does not expose provider response bodies", async () => {
    fetchMock.mockResolvedValueOnce(new Response("secret-provider-diagnostic", { status: 500 }))
    const error = await upload().catch((failure: unknown) => failure)
    expect(error).toMatchObject({ code: "IMAGE_UPLOAD_FAILED" })
    expect(String(error)).not.toContain("secret-provider-diagnostic")
  })
})
