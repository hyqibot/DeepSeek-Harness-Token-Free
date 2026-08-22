/** Abortable delay used by IM long-poll loops. */

/**
 * Wait until `ms` elapses or the signal aborts.
 * @param ms - delay in milliseconds.
 * @param signal - cooperative cancellation.
 */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}
