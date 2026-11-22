import { HelpProvider } from './HelpProvider';

export default { title: 'Help/BrowserLanguage', component: HelpProvider };

/** Uses browser preferences: no host locale override, no model service or customer data. */
export const Tutorial = {
  args: {
    pageKey: 'Dashboard',
    content: {
      pages: {
        Dashboard: {
          pageLabel: 'Dashboard',
          faq: [
            {
              id: 'overview',
              question: 'Show me the app overview',
              answer: 'Watch the overview.',
              videoId: 'overview',
            },
          ],
        },
      },
      videos: {
        overview: {
          youtubeId: 'PVvOu7YhQrs',
          title: 'System screens overview',
          captionTrack: { languageCode: 'ru', kind: 'asr' as const },
        },
      },
    },
  },
};
