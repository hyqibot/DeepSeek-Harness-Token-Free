/** Narrow `llm-pi-ai` writes so route sync cannot resurrect deleted providers. */

/**
 * Build a sparse settings patch that updates one provider route only.
 * `settings.update` deep-merges this shape, so other routes (including ones
 * the user just removed) are never rewritten from a stale in-memory snapshot.
 * @param providerId - pi-ai route key such as `hyqi` or `zero-token`.
 * @param profile - provider profile to store at that route.
 */
export function patchLlmPiAiProvider(
  providerId: string,
  profile: unknown,
): { providers: Record<string, unknown> } {
  return { providers: { [providerId]: profile } }
}

/**
 * Return whether one route patch would change persisted settings.
 * @param providers - current `llm-pi-ai.providers` value.
 * @param providerId - pi-ai route key to compare.
 * @param profile - desired profile for that route.
 */
export function llmPiAiProviderPatchNeeded(
  providers: Readonly<Record<string, unknown>> | undefined,
  providerId: string,
  profile: unknown,
): boolean {
  return JSON.stringify(providers?.[providerId] ?? null) !== JSON.stringify(profile)
}
