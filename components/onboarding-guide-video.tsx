"use client"

import { VideoEmbed } from "@/components/video-embed"
import { useOnboardingVideoEmbedUrl } from "@/lib/client/onboarding-video"

/**
 * The admin-configured onboarding video, embedded at the top of the extended
 * getting-started guide. Renders nothing until an admin sets a URL in /admin.
 */
export function OnboardingGuideVideo() {
  const embedUrl = useOnboardingVideoEmbedUrl()
  if (!embedUrl) return null
  return (
    <div className="mt-8 max-w-3xl">
      <VideoEmbed title="Getting Started with Atai" src={embedUrl} />
    </div>
  )
}
