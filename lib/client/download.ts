"use client"

/** Download a data URL as a local file (browser only). */
export async function downloadDataUrl(dataUrl: string, fileNameBase: string): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${fileNameBase}.${imageExtension(dataUrl)}`
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Best-effort file extension from a data URL's mime type. */
export function imageExtension(dataUrl: string): string {
  const mime = dataUrl.slice(dataUrl.indexOf(":") + 1, dataUrl.indexOf(";"))
  if (mime === "image/jpeg") return "jpg"
  if (mime.startsWith("image/")) return mime.slice("image/".length) || "png"
  return "png"
}
