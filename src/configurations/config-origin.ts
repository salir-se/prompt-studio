/**
 * Per-project configuration-origin persistence (ADR-235): which baseline a project was created
 * from, in localStorage (the same home as session variable declarations — the provider's
 * `ProjectRef` deliberately carries no metadata beyond id/name, and renames must never touch
 * history). "Reset configuration to its starting point" reads this; an unknown/missing origin
 * means the shipped default.
 */

const KEY_PREFIX = 'prompt-studio:config-origin:v1';

export function saveConfigOrigin(projectId: string, baselineId: string): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}:${projectId}`, baselineId);
  } catch {
    // localStorage can throw (quota, disabled) — origin tracking is a convenience; losing it
    // degrades reset to "shipped default", never breaks the app.
  }
}

export function loadConfigOrigin(projectId: string): string {
  try {
    return localStorage.getItem(`${KEY_PREFIX}:${projectId}`) ?? 'default';
  } catch {
    return 'default';
  }
}

export function forgetConfigOrigin(projectId: string): void {
  try {
    localStorage.removeItem(`${KEY_PREFIX}:${projectId}`);
  } catch {
    // Same posture as saveConfigOrigin.
  }
}
