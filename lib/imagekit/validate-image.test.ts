import { afterEach, describe, expect, it, vi } from "vitest"
import sharp from "sharp"
import { MAX_IMAGE_BYTES, readImageFile, validateImage } from "./validate-image"

const image = (format: "png" | "jpeg" | "webp" | "gif") => sharp({ create: { width: 8, height: 8, channels: 4, background: "red" } }).toFormat(format).toBuffer()
afterEach(() => vi.restoreAllMocks())

describe("actual image contents", () => {
  it.each(["png", "jpeg", "webp", "gif"] as const)("decodes and re-encodes %s", async (format) => {
    const result = await validateImage(await image(format), `image/${format}`)
    expect((await sharp(result.file).metadata()).format).toBe(format)
    expect(result.mimeType).toBe(`image/${format}`)
  })
  it("rejects arbitrary bytes disguised as an image", async () => {
    await expect(validateImage(Buffer.from('<svg onload="alert(1)"/>'), "image/png")).rejects.toMatchObject({ status: 422 })
  })
  it("rejects MIME disagreement even when bytes are a valid image", async () => {
    await expect(validateImage(await image("png"), "image/jpeg")).rejects.toMatchObject({ status: 422 })
  })
  it("rejects empty, oversized and truncated images", async () => {
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(MAX_IMAGE_BYTES + 1), (await image("png")).subarray(0, 35)]) {
      await expect(validateImage(bytes, "image/png")).rejects.toMatchObject({ status: 422 })
    }
  })
  it("removes payload appended to valid image data", async () => {
    const payload = "<script>untrusted-marker</script>"
    const result = await validateImage(Buffer.concat([await image("png"), Buffer.from(payload)]), "image/png")
    expect(result.file.includes(Buffer.from(payload))).toBe(false)
  })
  it("rejects unsupported SVG and AVIF", async () => {
    await expect(validateImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'), "image/svg+xml")).rejects.toMatchObject({ status: 422 })
    const avif = await sharp(await image("png")).avif().toBuffer()
    await expect(validateImage(avif, "image/avif")).rejects.toMatchObject({ status: 422 })
  })
})

describe("bounded multipart uploads", () => {
  const request = (...files: File[]) => {
    const form = new FormData()
    for (const file of files) form.append("file", file)
    return new Request("http://localhost/upload", { method: "POST", body: form })
  }
  it("reads exactly one file", async () => {
    const file = new File([new Uint8Array(await image("png"))], "valid.png", { type: "image/png" })
    expect((await readImageFile(request(file))).size).toBe(file.size)
    await expect(readImageFile(request(file, file))).rejects.toMatchObject({ code: "VALIDATION" })
  })
  it("rejects long names and empty files", async () => {
    await expect(readImageFile(request(new File(["x"], "x".repeat(181))))).rejects.toMatchObject({ code: "VALIDATION" })
    await expect(readImageFile(request(new File([], "empty.png")))).rejects.toMatchObject({ status: 413 })
  })
  it("bounds actual bytes even without content-length", async () => {
    const oversized = new Request("http://localhost/upload", { method: "POST", body: new Uint8Array(MAX_IMAGE_BYTES + 65 * 1024) })
    await expect(readImageFile(oversized)).rejects.toMatchObject({ status: 413 })
  })
})
