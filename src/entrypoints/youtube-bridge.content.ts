// MAIN-world bridge entrypoint. Runs inside the page's JavaScript realm so it
// can reach `movie_player` and hook fetch/XHR. Installs only the message
// listener at document_start; capture hooks are installed lazily via
// 'startCapture' so the page is untouched during normal browsing.

import { defineContentScript } from '#imports';
import { startMainBridge } from '../providers/youtube/main-bridge-runtime.js';

export default defineContentScript({
  matches: ['https://www.youtube.com/watch*', 'https://www.youtube.com/shorts/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    startMainBridge();
  },
});
