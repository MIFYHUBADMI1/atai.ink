import { AuthVisual } from "@/components/auth/auth-visual"

export function RegisterMarketing({ welcomeBonus }: { welcomeBonus?: number }) {
  return (
    <AuthVisual
      eyebrow="Start with Atai"
      heading="Turn an idea into a business you can run."
      body={`Create an account, describe the business you want to start, and review a plan before anything goes live. New accounts start with ${welcomeBonus ? `${welcomeBonus.toLocaleString()} credits` : "free credits"}. No credit card required.`}
      primary={{
        src: "/landing-images/atai-product.png",
        alt: "Atai workspace showing a business plan and product in progress",
      }}
      secondary={{
        src: "/landing-images/atai-growth.png",
        alt: "Atai growth and launch view",
      }}
    />
  )
}
