import { describe, expect, it } from "vitest"
import { buildNotificationInbox } from "./view-model"

describe("buildNotificationInbox ad requests", () => {
  it("surfaces quotations that need founder action", () => {
    const items = buildNotificationInbox({
      emailVerified: true,
      now: 50,
      projects: [],
      adRequests: [
        {
          id: "adreq_1",
          projectId: "proj_1",
          title: "Sweet Crust",
          status: "awaiting_approval",
          updatedAt: 40,
        },
      ],
    })
    const item = items.find((row) => row.id.startsWith("adreq-adreq_1"))
    expect(item?.kind).toBe("action")
    expect(item?.href).toContain("/project/proj_1/ads?tab=promote&request=adreq_1")
  })
})
