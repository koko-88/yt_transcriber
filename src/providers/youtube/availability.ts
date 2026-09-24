// Maps YouTube playability/player state onto the canonical Availability enum.
// Pure function — fully unit-testable without a browser.

import type { Availability } from "../../core/result.js";
import type { PlayerSnapshot } from "./bridge-protocol.js";

const LOGIN_REASONS = /sign in|login|confirm.*not a bot|bot/i;
const AGE_REASONS = /age|confirm your age|content warning/i;
const MEMBER_REASONS = /member|join this channel|sponsor/i;

export function mapSnapshotToAvailability(snap: PlayerSnapshot): Availability {
  const status = snap.playabilityStatus ?? "";
  const reason = snap.playabilityReason ?? "";

  if (snap.isUpcoming || status === "LIVE_STREAM_OFFLINE") return "upcoming";
  if (snap.isLive) return "live-in-progress";

  if (status === "LOGIN_REQUIRED" || LOGIN_REASONS.test(reason))
    return "login-required";
  if (AGE_REASONS.test(reason) || status === "AGE_CHECK_REQUIRED")
    return "age-restricted";
  if (MEMBER_REASONS.test(reason)) return "members-only";

  if (status === "OK" || status === "") {
    if (!snap.videoId) return "not-a-video-page";
    if (snap.tracks.length === 0) return "no-captions";
    return "available";
  }

  if (status === "UNPLAYABLE" || status === "ERROR") {
    // Unplayable with tracks listed is still acquirable; without, treat as gated.
    return snap.tracks.length > 0 ? "available" : "unknown";
  }

  return "unknown";
}

export const RETRYABLE: ReadonlySet<Availability> = new Set([
  "fetch-empty",
  "needs-player-interaction",
  "network-error",
  "unsupported-page-structure",
  "unknown",
]);
