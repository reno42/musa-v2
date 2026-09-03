/**
 * Social publishing providers and what each one can do.
 *
 * Buffer is publishing-only: posts and schedules, no conversation surface.
 * Zernio adds the inbox (messages + comments) and contact capture into the
 * CRM, which is why inbox features must degrade gracefully when only Buffer
 * is connected.
 *
 * Pure on purpose — the API routes use it as the routing policy and the
 * ContentTab UI uses it for badges and pane visibility, so both ends agree
 * on one rule instead of two that drift.
 */

export type SocialProviderId = "buffer" | "zernio";

export interface SocialCapabilities {
  publish: boolean;
  schedule: boolean;
  /** Zernio only: messages + comments inbox. */
  inbox: boolean;
  /** Zernio only: capture a conversation's author into the workspace CRM. */
  crmCapture: boolean;
}

export const SOCIAL_CAPABILITIES: Record<SocialProviderId, SocialCapabilities> = {
  buffer: { publish: true, schedule: true, inbox: false, crmCapture: false },
  zernio: { publish: true, schedule: true, inbox: true, crmCapture: true },
};

/**
 * Who carries a piece, in preference order. Buffer first so routine posts
 * spend Buffer's quota instead of Zernio credits when both are connected
 * (freemium rule); stories and reels are a Zernio capability — Buffer's API
 * cannot place them, so their order is Zernio-only.
 */
export function publishProviderOrder(contentType: "post" | "story" | "reel" = "post"): SocialProviderId[] {
  return contentType === "post" ? ["buffer", "zernio"] : ["zernio"];
}

/** The connected provider that would carry this piece, or null if none. */
export function pickPublishProvider(
  connectedProviders: string[],
  contentType: "post" | "story" | "reel" = "post",
): SocialProviderId | null {
  for (const provider of publishProviderOrder(contentType)) {
    if (connectedProviders.includes(provider)) return provider;
  }
  return null;
}
