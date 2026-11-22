import { FaqAccordion } from './FaqAccordion';

const meta = { title: 'Help/FaqAccordion', component: FaqAccordion };
export default meta;

export const Default = {
  args: {
    pageKey: 'Scout',
    items: [
      { id: 'scout.what', question: 'How do I start a search?', answer: 'Click Run Scout.', videoId: 'scout-intro' },
      { id: 'scout.score', question: 'What does the score mean?', answer: '0-100 ICP fit.' },
    ],
    videos: { 'scout-intro': { youtubeId: 'dQw4w9WgXcQ', title: 'Scout intro' } },
  },
};
