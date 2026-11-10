import { describe, expect, it, vi } from "vitest"
import {
  CreateSubscriptionInputSchema,
  ListPaymentsInputSchema,
  ListPayoutsInputSchema,
  toDodoSubscriptionRequest,
  toSubscriptionResult,
  toDodoListPaymentsQuery,
  toPaymentsPage,
  toDodoListPayoutsQuery,
  toPayoutsPage,
  toDodoCheckoutRequest,
  toCheckoutResult,
} from "./mapper"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const VALID_SUBSCRIPTION_INPUT = {
  productId: "prdtxxxxxxxxxxxx",
  quantity: 2,
  customer: { email: "customer@example.com", name: "Ada Tester" },
  billing: { country: "US", city: "Kampala" },
  returnUrl: "https://example.com/return",
  metadata: { plan: "pro" },
}

describe("createSubscription — request translation", () => {
  it("translates a valid input into the documented Dodo body", () => {
    const translated = toDodoSubscriptionRequest(VALID_SUBSCRIPTION_INPUT)
    expect(translated.body).toEqual({
      product_id: "prdtxxxxxxxxxxxx",
      quantity: 2,
      customer: { email: "customer@example.com", name: "Ada Tester" },
      billing: { country: "US", city: "Kampala" },
      return_url: "https://example.com/return",
      metadata: { plan: "pro" },
    })
  })

  it("rejects missing billing country and non-2-letter country codes", () => {
    expect(() =>
      toDodoSubscriptionRequest({ ...VALID_SUBSCRIPTION_INPUT, billing: { country: "USA" } }),
    ).toThrow()
    expect(() => toDodoSubscriptionRequest({
      productId: "prdtxxxxxxxxxxxx",
      customer: VALID_SUBSCRIPTION_INPUT.customer,
    })).toThrow()
  })

  it("rejects an invalid customer email", () => {
    expect(() =>
      toDodoSubscriptionRequest({
        ...VALID_SUBSCRIPTION_INPUT,
        customer: { email: "not-an-email", name: "Ada" },
      }),
    ).toThrow()
  })

  it("rejects unknown fields (strict schema)", () => {
    expect(() => toDodoSubscriptionRequest({ ...VALID_SUBSCRIPTION_INPUT, extra: 1 })).toThrow()
  })

  it("rejects oversized metadata entries", () => {
    const metadata: Record<string, string> = {}
    for (let i = 0; i < 21; i++) metadata[`k${i}`] = String(i)
    try {
      toDodoSubscriptionRequest({ ...VALID_SUBSCRIPTION_INPUT, metadata })
      expect.unreachable("expected the oversized metadata to be rejected")
    } catch (e) {
      expect((e as { detail?: string }).detail).toMatch(/metadata/)
    }
  })
})

describe("createSubscription — response normalization", () => {
  it("normalizes a documented provider response", () => {
    const result = toSubscriptionResult({
      subscription_id: "sub_1",
      payment_id: "pay_1",
      payment_link: "https://dodo.test/pay",
      recurring_pre_tax_amount: 2990,
    })
    expect(result.provider).toBe("dodo")
    expect(result.data).toEqual({
      subscriptionId: "sub_1",
      paymentId: "pay_1",
      paymentLink: "https://dodo.test/pay",
      recurringPreTaxAmount: 2990,
    })
    expect(result.usage?.metadata).toEqual({ subscriptionCreated: 1 })
  })

  it("rejects a response missing the subscription id", () => {
    expect(() => toSubscriptionResult({ payment_id: "pay_1" })).toThrow()
  })
})

describe("listPayments — query translation & page normalization", () => {
  it("translates filters into provider query params", () => {
    expect(toDodoListPaymentsQuery({ limit: 20, status: "succeeded", subscriptionId: "sub_1" })).toEqual({
      query: { page_size: 20, status: "succeeded", subscription_id: "sub_1" },
    })
  })

  it("accepts an empty input as a bare read", () => {
    expect(toDodoListPaymentsQuery(undefined)).toEqual({ query: {} })
  })

  it("rejects a limit above the documented page size", () => {
    expect(() => toDodoListPaymentsQuery({ limit: 101 })).toThrow()
  })

  it("normalizes the paginated items feed with scalar-only metadata", () => {
    const result = toPaymentsPage({
      items: [
        {
          payment_id: "pay_1",
          total_amount: 2990,
          currency: "USD",
          status: "succeeded",
          created_at: "2026-10-01T00:00:00Z",
          subscription_id: "sub_1",
          customer: { email: "a@b.co", name: "Ada" },
          metadata: { plan: "pro", nested: { dropped: true }, n: 3 },
        },
        { payment_id: "pay_2", total_amount: 1000, status: "processing", created_at: "bogus" },
        "not-an-object",
        { no_id: true },
      ],
    })
    expect(result.data.payments).toHaveLength(2)
    expect(result.data.payments[0]).toEqual({
      paymentId: "pay_1",
      amount: 2990,
      currency: "USD",
      status: "succeeded",
      createdAt: Date.parse("2026-10-01T00:00:00Z"),
      subscriptionId: "sub_1",
      customerEmail: "a@b.co",
      metadata: { plan: "pro", n: 3 },
    })
    expect(result.data.payments[1]?.createdAt).toBeNull()
    expect(result.data.pageFull).toBe(false)
    expect(result.usage?.metadata).toEqual({ paymentsListed: 2 })
  })

  it("rejects a body without the items array", () => {
    expect(() => toPaymentsPage({ nothing: 1 })).toThrow()
  })

  it("caps a page at 100 items and reports pageFull", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ payment_id: `p${i}` }))
    expect(toPaymentsPage({ items }).data.pageFull).toBe(true)
  })
})

describe("listPayouts — query translation & page normalization", () => {
  it("translates the limit and normalizes items", () => {
    expect(toDodoListPayoutsQuery({ limit: 10 })).toEqual({ query: { page_size: 10 } })
    const result = toPayoutsPage({
      items: [
        {
          payout_id: "po_1",
          amount: 50000,
          currency: "USD",
          status: "success",
          payment_method: "bank",
          name: "Payout",
          created_at: "2026-10-02T00:00:00Z",
        },
      ],
    })
    expect(result.data.payouts).toHaveLength(1)
    expect(result.data.payouts[0]).toEqual({
      payoutId: "po_1",
      amount: 50000,
      currency: "USD",
      status: "success",
      paymentMethod: "bank",
      name: "Payout",
      createdAt: Date.parse("2026-10-02T00:00:00Z"),
    })
    expect(result.usage?.metadata).toEqual({ payoutsListed: 1 })
  })

  it("rejects unknown filters", () => {
    expect(() => toDodoListPayoutsQuery({ status: "x" })).toThrow()
  })
})

describe("checkout routes through the real Dodo product_cart wire shape", () => {
  it("translates items into product_cart and maps urls/currency", () => {
    const translated = toDodoCheckoutRequest({
      items: [{ productId: "pdt_123", name: "Pro", quantity: 2, price: 29.9 }],
      successUrl: "https://example.com/ok",
      customerEmail: "customer@example.com",
      currency: "USD",
    })
    expect(translated.body).toEqual({
      product_cart: [{ product_id: "pdt_123", quantity: 2 }],
      return_url: "https://example.com/ok",
      customer_email: "customer@example.com",
      billing_currency: "USD",
      metadata: { _ataiItemNames: "Pro" },
    })
  })

  it("falls back to the server-configured default product", () => {
    const translated = toDodoCheckoutRequest({ items: [{ name: "Pro", quantity: 1 }] }, "pdt_default")
    expect(translated.body.product_cart).toEqual([{ product_id: "pdt_default", quantity: 1 }])
  })

  it("rejects catalog-less items when no default product is configured", () => {
    let caught: unknown
    try {
      toDodoCheckoutRequest({ items: [{ name: "Pro", quantity: 1, price: 5 }] })
      expect.unreachable("expected a normalized invalid-body error")
    } catch (e) {
      caught = e
    }
    expect((caught as { detail?: string }).detail).toMatch(/DODO_CHECKOUT_DEFAULT_PRODUCT_ID/)
  })

  it("keeps metadata and omits unset fields", () => {
    const translated = toDodoCheckoutRequest({
      items: [{ productId: "pdt_123", quantity: 1 }],
      metadata: { plan: "pro" },
    })
    expect(translated.body.metadata).toEqual({ plan: "pro" })
    expect(translated.body.return_url).toBeUndefined()
    expect(translated.body.billing_currency).toBeUndefined()
  })

  it("normalizes the live session_id response", () => {
    const result = toCheckoutResult({ session_id: "cks_1", checkout_url: "https://checkout.test/1" })
    expect(result.data).toEqual({ checkoutId: "cks_1", checkoutUrl: "https://checkout.test/1", status: "pending" })
  })
})

// Schemas are consumed server-side; verify they parse the tested shapes.
describe("schemas", () => {
  it("ListPaymentsInputSchema rejects negative limits", () => {
    expect(ListPaymentsInputSchema.safeParse({ limit: -1 }).success).toBe(false)
  })
  it("ListPayoutsInputSchema rejects unknown keys", () => {
    expect(ListPayoutsInputSchema.safeParse({ bogus: 1 }).success).toBe(false)
  })
  it("CreateSubscriptionInputSchema defaults quantity checks to service level", () => {
    expect(CreateSubscriptionInputSchema.safeParse({ ...VALID_SUBSCRIPTION_INPUT, quantity: 0 }).success).toBe(false)
    expect(CreateSubscriptionInputSchema.safeParse({ ...VALID_SUBSCRIPTION_INPUT, quantity: 1001 }).success).toBe(false)
  })
})

// ── Adapter-level tenancy: the provider feed is account-wide, the key is not ──

vi.mock("./config", () => ({
  getDodoDefaultCheckoutProductId: () => "pdt_default",
}))
vi.mock("./client", () => ({
  executeCreateCheckout: vi.fn(),
  executeCreateSubscription: vi.fn(),
  executeListPayments: vi.fn(),
  executeListPayouts: vi.fn(),
}))

import { executeListPayments, executeListPayouts } from "./client"
import { dodoAdapter } from "./adapter"
import type { ProviderExecutionRequest } from "@/runtime/contracts/router"
import type { Mock } from "vitest"

const mockedExecuteListPayments = executeListPayments as unknown as Mock
const mockedExecuteListPayouts = executeListPayouts as unknown as Mock

function paymentsRequest(operation: string, input: Record<string, unknown> = {}): ProviderExecutionRequest {
  return {
    auth: {
      apiKeyId: "rkey_test",
      userId: "user_1",
      projectId: "proj_own",
      environment: "development",
      scopes: ["payments"],
    },
    requestId: "rtreq_test",
    request: { capability: "payments", operation, input },
  }
}

const OWN_PAYMENT = {
  payment_id: "pay_own",
  total_amount: 2990,
  currency: "USD",
  status: "succeeded",
  created_at: "2026-11-01T00:00:00Z",
  customer: { email: "own-customer@example.com", name: "Own" },
  metadata: { _ataiProjectId: "proj_own", plan: "pro" },
}
const FOREIGN_PAYMENT = {
  payment_id: "pay_foreign",
  total_amount: 5000,
  status: "succeeded",
  customer: { email: "other-founders-customer@example.com", name: "Foreign" },
  metadata: { _ataiProjectId: "proj_other" },
}
const UNTAGGED_PAYMENT = { payment_id: "pay_untagged", total_amount: 100, status: "succeeded" }

describe("dodoAdapter listPayments tenancy", () => {
  it("returns only payments attributed to the authenticated project", async () => {
    mockedExecuteListPayments.mockResolvedValue({
      payload: { items: [FOREIGN_PAYMENT, OWN_PAYMENT, UNTAGGED_PAYMENT] },
      latencyMs: 5,
    })
    const result = await dodoAdapter.execute(paymentsRequest("listPayments", { limit: 10 }))
    expect(result.data).toEqual({
      payments: [
        expect.objectContaining({
          paymentId: "pay_own",
          customerEmail: "own-customer@example.com",
          metadata: { _ataiProjectId: "proj_own", plan: "pro" },
        }),
      ],
      pageFull: false,
    })
    expect(result.usage?.metadata).toEqual({ paymentsListed: 1 })
  })

  it("never leaks foreign records, even when they fill the whole raw page", async () => {
    const foreignPage = Array.from({ length: 100 }, (_, i) => ({
      payment_id: `pay_f${i}`,
      customer: { email: `other${i}@example.com` },
      metadata: { _ataiProjectId: "proj_other" },
    }))
    mockedExecuteListPayments.mockResolvedValue({ payload: { items: foreignPage }, latencyMs: 5 })
    const result = await dodoAdapter.execute(paymentsRequest("listPayments"))
    expect(result.data).toEqual({ payments: [], pageFull: true })
  })

  it("does not let unrestricted scopes widen the project boundary", async () => {
    mockedExecuteListPayments.mockResolvedValue({ payload: { items: [FOREIGN_PAYMENT, OWN_PAYMENT] }, latencyMs: 5 })
    const request = paymentsRequest("listPayments")
    request.auth.scopes = []
    const result = await dodoAdapter.execute(request)
    expect(result.data).toMatchObject({ payments: [expect.objectContaining({ paymentId: "pay_own" })] })
  })

  it("rejects caller-supplied project attribution in the query", async () => {
    await expect(dodoAdapter.execute(paymentsRequest("listPayments", { projectId: "proj_other" })))
      .rejects.toMatchObject({ name: "ProviderExecutionError", detail: expect.stringContaining("validation failed") })
    expect(mockedExecuteListPayments).not.toHaveBeenCalled()
  })

  it("keeps foreign customer and subscription filters inside the project boundary", async () => {
    mockedExecuteListPayments.mockResolvedValue({ payload: { items: [FOREIGN_PAYMENT] }, latencyMs: 5 })
    const result = await dodoAdapter.execute(paymentsRequest("listPayments", {
      customerId: "customer_foreign", subscriptionId: "sub_foreign",
    }))
    expect(result.data).toMatchObject({ payments: [] })
  })

  it("passes caller filters through as the documented query while scoping results", async () => {
    mockedExecuteListPayments.mockResolvedValue({ payload: { items: [OWN_PAYMENT] }, latencyMs: 5 })
    await dodoAdapter.execute(paymentsRequest("listPayments", { limit: 10, status: "succeeded" }))
    expect(mockedExecuteListPayments).toHaveBeenCalledTimes(1)
    expect(mockedExecuteListPayments.mock.calls[0][0]).toMatchObject({
      query: { page_size: 10, status: "succeeded" },
    })
  })
})

describe("dodoAdapter listPayouts denial", () => {
  it("denies payouts to application keys without touching the provider", async () => {
    await expect(dodoAdapter.execute(paymentsRequest("listPayouts"))).rejects.toMatchObject({
      name: "ProviderExecutionError",
      category: "unsupported_operation",
      message: expect.stringContaining("platform-account"),
    })
    expect(mockedExecuteListPayouts).not.toHaveBeenCalled()
  })
})
