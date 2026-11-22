import type { Message } from '../text';

export const TIMELINE_RAIL_COPY = {
  timeline: { key: 'outreach.navigation.timeline', defaultValue: 'Conversation timeline' },
  jump: { key: 'outreach.navigation.jump', defaultValue: 'Jump through conversation' },
  keyboard: {
    key: 'outreach.navigation.keyboard',
    defaultValue: 'Arrow keys select a destination; Enter moves focus to it. Page Up and Page Down show more marks.',
  },
  up: { key: 'outreach.navigation.up', defaultValue: 'Scroll up' },
  down: { key: 'outreach.navigation.down', defaultValue: 'Scroll down' },
  region: { key: 'ui.timeline.region', defaultValue: 'Content timeline' },
  jumpRegion: { key: 'ui.timeline.jumpRegion', defaultValue: 'Jump through content' },
  top: { key: 'ui.timeline.top', defaultValue: 'Top of content' },
  bottom: { key: 'ui.timeline.bottom', defaultValue: 'End of content' },
} as const satisfies Record<string, Message>;
