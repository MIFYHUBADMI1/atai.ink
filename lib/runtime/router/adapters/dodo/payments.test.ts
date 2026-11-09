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
