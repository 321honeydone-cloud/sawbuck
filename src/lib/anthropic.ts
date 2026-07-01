// Shared Anthropic client + transient-error helpers.
//
// Every AI route used to do `new Anthropic({ apiKey })` with the SDK default of
// 2 retries. When Anthropic's servers are briefly busy they return HTTP 529
// "Overloaded" (a transient, server-side hiccup, not a bug in this app). With
// the default settings that occasionally leaked a raw `overloaded_error` into
// the estimator chat. This factory raises the retry budget so the SDK rides out
// those blips with exponential backoff before any error is ever surfaced.

import Anthropic from "@anthropic-ai/sdk";

/**
 * Build the Anthropic client used by every AI route.
 * The SDK automatically retries 408 / 409 / 429 / 500 / 503 / 529 with
 * exponential backoff (and honors Retry-After), so a momentary overload is
 * invisible to the user instead of failing the request.
 */
export function makeAnthropic(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    maxRetries: 5, // default is 2; covers brief Anthropic overloads
    timeout: 120_000, // 2 min, gives Opus room on long estimates
  });
}

/** True for errors that are worth retrying (server busy, rate limit, network). */
export function isTransientAiError(err: unknown): boolean {
  const e = err as { status?: number; message?: string; name?: string } | null;
  if (!e) return false;
  if (e.status && [408, 409, 429, 500, 502, 503, 529].includes(e.status)) return true;
  const m = `${e.message ?? ""} ${e.name ?? ""}`.toLowerCase();
  return /overload|rate.?limit|too many requests|timeout|timed out|econnreset|etimedout|fetch failed|network|socket hang up/.test(
    m
  );
}

/** Plain-English note for the rare case a transient error survives all retries. */
export function friendlyAiError(err: unknown): string {
  const e = err as { status?: number; message?: string } | null;
  const msg = (e?.message ?? "").toLowerCase();
  const overloaded = e?.status === 529 || /overload/.test(msg);
  const rateLimited = e?.status === 429 || /rate.?limit|too many requests/.test(msg);

  if (overloaded) {
    return "Anthropic's servers were briefly overloaded and the estimator could not get through, even after a few automatic retries. Your estimate is safe. Give it a few seconds and hit Send again.";
  }
  if (rateLimited) {
    return "The AI is being rate limited right now. Wait a few seconds and try that again. Your estimate is safe.";
  }
  return "The estimator had a temporary problem reaching the AI. Your estimate is safe, just try that again in a moment.";
}
