// Offscreen document lifecycle. One document orchestrates every loop (§3.4).
// Reason WORKERS exists for long-running background work; justification is
// required by Chrome and shown in review.
let creating: Promise<void> | null = null;

export async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL('offscreen.html');
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [url],
  }).catch(() => []);
  if (existing.length > 0) return;

  creating ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Hosts the agent loops that drive tabs during a run',
    })
    .finally(() => {
      creating = null;
    });
  return creating;
}
