import type { RunSettings } from './contracts';

export const RUN_SETTINGS_CHANGED = 'studio:run-settings-changed';

export function announceRunSettings(settings: RunSettings): void {
  window.dispatchEvent(new CustomEvent<RunSettings>(RUN_SETTINGS_CHANGED, { detail: settings }));
}
