// ISOLATED-world YouTube content script entrypoint. Delegates all work to the
// session manager; matches all of youtube.com so the script survives SPA
// navigations (YouTube never does full reloads).

import { defineContentScript } from '#imports';
import { startYouTubeSession } from '../providers/youtube/session.js';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  excludeMatches: ['https://music.youtube.com/*', 'https://studio.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    startYouTubeSession();
  },
});
