export const inputClass = "v2-input";

export const textareaClass = "v2-textarea";

export const labelClass = "v2-label";

export const cardClass = "v2-panel p-4";

export const linkClass = "text-link font-medium";

export const mutedLinkClass = "text-muted-foreground transition-colors hover:text-ink";

export const alertErrorClass = "v2-alert";

export const alertInfoClass = "v2-note";

/**
 * Keep the skeleton visible long enough to avoid a flash on fast local/staging
 * responses. The task result (or error) is always preserved.
 */
export async function withSkeletonDelay<T>(task: Promise<T>, minimumMs = 180): Promise<T> {
  const started = performance.now();
  try {
    return await task;
  } finally {
    const remaining = minimumMs - (performance.now() - started);
    if (remaining > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
  }
}

/** Wait out the remaining part of a minimum skeleton window. */
export async function ensureSkeletonDuration(started: number, minimumMs = 180): Promise<void> {
  const remaining = minimumMs - (performance.now() - started);
  if (remaining > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
}
