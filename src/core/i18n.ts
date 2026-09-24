// Internationalization — English and Arabic per plan
// Flat key-value with ICU-like plurals handled manually
// No external i18n library in V1

export type Locale = 'en' | 'ar';

export type Direction = 'ltr' | 'rtl';

export function getDirection(locale: Locale): Direction {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export const messages = {
  en: {
    // App
    'app.name': 'Transcript Workbench',
    'app.tagline': 'Your data stays local, your AI is your choice.',

    // Navigation
    'nav.transcript': 'Transcript',
    'nav.library': 'Library',
    'nav.ai': 'AI',
    'nav.settings': 'Settings',

    // Transcript
    'transcript.loading': 'Loading transcript…',
    'transcript.search.placeholder': 'Search transcript…',
    'transcript.search.results': '{count} results',
    'transcript.view.paragraph': 'Paragraph',
    'transcript.view.raw': 'Raw',
    'transcript.follow': 'Follow playback',
    'transcript.copy.text': 'Copy text',
    'transcript.copy.timestamps': 'Copy with timestamps',
    'transcript.copy.link': 'Copy link at timestamp',
    'transcript.copy.done': 'Copied!',
    'transcript.export': 'Export',
    'transcript.export.txt': 'Plain Text (.txt)',
    'transcript.export.md': 'Markdown (.md)',
    'transcript.export.srt': 'SubRip (.srt)',
    'transcript.export.vtt': 'WebVTT (.vtt)',
    'transcript.export.json': 'JSON (.json)',
    'transcript.tracks': 'Tracks',
    'transcript.tracks.manual': 'Manual',
    'transcript.tracks.asr': 'Auto-generated',
    'transcript.tracks.translated': 'Translated',
    'transcript.segments': '{count} segments',
    'transcript.jumpToNow': 'Jump to now',

    // Availability
    'availability.available': 'Transcript available',
    'availability.no-captions': 'No captions available for this video',
    'availability.login-required': 'Sign in to YouTube to view this transcript',
    'availability.age-restricted': 'This video is age-restricted',
    'availability.members-only': 'This video is for channel members only',
    'availability.live-in-progress': 'Live streams are not supported yet',
    'availability.upcoming': 'This video has not premiered yet',
    'availability.not-a-video-page': 'Navigate to a YouTube video to see its transcript',
    'availability.fetch-empty': 'Captions exist but returned empty data. Try reloading the page.',
    'availability.needs-player-interaction': 'Play the video or enable captions to load the transcript',
    'availability.parse-failed': 'Failed to parse the caption data',
    'availability.unsupported-page-structure': 'YouTube page structure has changed. Check for extension updates.',
    'availability.network-error': 'Network error while loading captions',
    'availability.unknown': 'An unexpected error occurred',

    // Library
    'library.title': 'Library',
    'library.empty': 'No saved transcripts yet',
    'library.empty.hint': 'Save a transcript from the transcript tab to see it here.',
    'library.save': 'Save to library',
    'library.saved': 'Saved',
    'library.unsave': 'Remove from library',
    'library.search.placeholder': 'Search library…',
    'library.recents': 'Recents',
    'library.favorites': 'Favorites',
    'library.all': 'All saved',
    'library.tags': 'Tags',
    'library.notes': 'Notes',
    'library.highlights': 'Highlights',
    'library.export': 'Export library backup',
    'library.import': 'Import library backup',
    'library.clear': 'Clear all data',
    'library.clear.confirm': 'This will delete all saved transcripts, notes, highlights, and tags. This cannot be undone.',
    'library.storage': 'Storage used',

    // Notes
    'notes.title': 'Notes',
    'notes.add': 'Add note',
    'notes.placeholder': 'Write a note…',
    'notes.empty': 'No notes yet',
    'notes.delete': 'Delete note',
    'notes.delete.confirm': 'Delete this note?',

    // Highlights
    'highlights.title': 'Highlights',
    'highlights.add': 'Highlight segment',
    'highlights.remove': 'Remove highlight',
    'highlights.empty': 'No highlights yet',
    'highlights.color': 'Highlight color',

    // Tags
    'tags.add': 'Add tag',
    'tags.remove': 'Remove tag',
    'tags.placeholder': 'Tag name…',

    // AI
    'ai.title': 'AI Assistant',
    'ai.setup': 'Set up AI',
    'ai.setup.description': 'Connect an AI provider to summarize and ask questions about transcripts.',
    'ai.provider': 'Provider',
    'ai.model': 'Model',
    'ai.apiKey': 'API Key',
    'ai.apiKey.hint': 'Stored unencrypted in the extension\'s private database. Websites and page scripts cannot read it. Anyone who can read your browser profile or run software as you can.',
    'ai.sessionOnly': 'Forget key when browser closes',
    'ai.test': 'Test connection',
    'ai.test.success': 'Connection successful',
    'ai.test.failed': 'Connection failed',
    'ai.summary': 'Summary',
    'ai.takeaways': 'Key Takeaways',
    'ai.chapters': 'Chapters',
    'ai.qa': 'Ask a Question',
    'ai.qa.placeholder': 'Ask about the video…',
    'ai.generating': 'Generating…',
    'ai.cancel': 'Cancel',
    'ai.cached': 'Cached result',
    'ai.consent': 'Transcript text will be sent to {provider}. Continue?',
    'ai.consent.firefox': 'This extension will transmit website content to {provider} for AI processing.',
    'ai.strictMode': 'Strict Local Mode is enabled. Only local AI providers are allowed.',
    'ai.error.auth': 'Authentication failed. Check your API key.',
    'ai.error.rateLimit': 'Rate limited. Please try again later.',
    'ai.error.network': 'Network error. Check your connection.',
    'ai.error.cors': 'CORS error. The provider may need host permission.',
    'ai.error.originRejected': 'The server rejected the request origin.',
    'ai.error.model': 'Model error. Try a different model.',
    'ai.error.contextTooLarge': 'The transcript is too long for this model.',
    'ai.error.cancelled': 'Generation cancelled.',
    'ai.error.blockedStrict': 'Blocked by Strict Local Mode.',

    // Settings
    'settings.title': 'Settings',
    'settings.theme': 'Theme',
    'settings.theme.light': 'Light',
    'settings.theme.dark': 'Dark',
    'settings.theme.system': 'System',
    'settings.language': 'Language',
    'settings.strictMode': 'Strict Local Mode',
    'settings.strictMode.description': 'Block all remote AI requests. Only local models (Ollama, LM Studio) and Chrome built-in AI are allowed. This does not affect YouTube page traffic or browser updates.',
    'settings.diagnostics': 'Copy diagnostics',
    'settings.diagnostics.copied': 'Diagnostics copied to clipboard',
    'settings.about': 'About',
    'settings.version': 'Version',
    'settings.backup': 'Backup & Restore',
    'settings.storage': 'Storage',
    'settings.privacy': 'Privacy Policy',
    'settings.inPlayerButton': 'Show button in YouTube player',
    'settings.inPlayerButton.description': 'Adds a transcript button to the YouTube player controls. Off by default to reduce detection.',

    // Permissions
    'permission.youtube.revoked': 'YouTube access was removed',
    'permission.youtube.grant': 'Grant access to YouTube',
    'permission.ai.grant': 'Grant access to {origin}',

    // General
    'general.save': 'Save',
    'general.cancel': 'Cancel',
    'general.delete': 'Delete',
    'general.close': 'Close',
    'general.loading': 'Loading…',
    'general.error': 'Error',
    'general.retry': 'Retry',
    'general.confirm': 'Confirm',
    'general.success': 'Success',
  },
  ar: {
    // App
    'app.name': 'منصة النسخ النصي',
    'app.tagline': 'بياناتك محلية، والذكاء الاصطناعي خيارك.',

    // Navigation
    'nav.transcript': 'النسخة النصية',
    'nav.library': 'المكتبة',
    'nav.ai': 'الذكاء الاصطناعي',
    'nav.settings': 'الإعدادات',

    // Transcript
    'transcript.loading': 'جاري تحميل النسخة النصية…',
    'transcript.search.placeholder': 'البحث في النسخة النصية…',
    'transcript.search.results': '{count} نتائج',
    'transcript.view.paragraph': 'فقرات',
    'transcript.view.raw': 'خام',
    'transcript.follow': 'تتبع التشغيل',
    'transcript.copy.text': 'نسخ النص',
    'transcript.copy.timestamps': 'نسخ مع الأوقات',
    'transcript.copy.link': 'نسخ الرابط عند الوقت',
    'transcript.copy.done': 'تم النسخ!',
    'transcript.export': 'تصدير',
    'transcript.export.txt': 'نص عادي (.txt)',
    'transcript.export.md': 'ماركداون (.md)',
    'transcript.export.srt': 'SubRip (.srt)',
    'transcript.export.vtt': 'WebVTT (.vtt)',
    'transcript.export.json': 'JSON (.json)',
    'transcript.tracks': 'المسارات',
    'transcript.tracks.manual': 'يدوي',
    'transcript.tracks.asr': 'تلقائي',
    'transcript.tracks.translated': 'مترجم',
    'transcript.segments': '{count} مقطع',
    'transcript.jumpToNow': 'انتقل إلى الآن',

    // Availability
    'availability.available': 'النسخة النصية متاحة',
    'availability.no-captions': 'لا تتوفر تعليقات توضيحية لهذا الفيديو',
    'availability.login-required': 'سجّل الدخول إلى YouTube لعرض هذه النسخة النصية',
    'availability.age-restricted': 'هذا الفيديو مقيد بالعمر',
    'availability.members-only': 'هذا الفيديو لأعضاء القناة فقط',
    'availability.live-in-progress': 'البث المباشر غير مدعوم بعد',
    'availability.upcoming': 'لم يتم عرض هذا الفيديو بعد',
    'availability.not-a-video-page': 'انتقل إلى فيديو YouTube لعرض النسخة النصية',
    'availability.fetch-empty': 'التعليقات موجودة لكنها أعادت بيانات فارغة. حاول إعادة تحميل الصفحة.',
    'availability.needs-player-interaction': 'شغّل الفيديو أو فعّل التعليقات لتحميل النسخة النصية',
    'availability.parse-failed': 'فشل في تحليل بيانات التعليقات',
    'availability.unsupported-page-structure': 'تغير هيكل صفحة YouTube. تحقق من تحديثات الإضافة.',
    'availability.network-error': 'خطأ في الشبكة أثناء تحميل التعليقات',
    'availability.unknown': 'حدث خطأ غير متوقع',

    // Library
    'library.title': 'المكتبة',
    'library.empty': 'لا توجد نسخ نصية محفوظة بعد',
    'library.empty.hint': 'احفظ نسخة نصية من تبويب النسخة النصية لتظهر هنا.',
    'library.save': 'حفظ في المكتبة',
    'library.saved': 'محفوظ',
    'library.unsave': 'إزالة من المكتبة',
    'library.search.placeholder': 'البحث في المكتبة…',
    'library.recents': 'الأخيرة',
    'library.favorites': 'المفضلة',
    'library.all': 'الكل',
    'library.tags': 'العلامات',
    'library.notes': 'الملاحظات',
    'library.highlights': 'التمييزات',
    'library.export': 'تصدير نسخة احتياطية',
    'library.import': 'استيراد نسخة احتياطية',
    'library.clear': 'مسح كل البيانات',
    'library.clear.confirm': 'سيؤدي هذا إلى حذف جميع النسخ النصية والملاحظات والتمييزات والعلامات المحفوظة. لا يمكن التراجع عن هذا.',
    'library.storage': 'التخزين المستخدم',

    // Notes
    'notes.title': 'ملاحظات',
    'notes.add': 'إضافة ملاحظة',
    'notes.placeholder': 'اكتب ملاحظة…',
    'notes.empty': 'لا توجد ملاحظات بعد',
    'notes.delete': 'حذف الملاحظة',
    'notes.delete.confirm': 'حذف هذه الملاحظة؟',

    // Highlights
    'highlights.title': 'التمييزات',
    'highlights.add': 'تمييز المقطع',
    'highlights.remove': 'إزالة التمييز',
    'highlights.empty': 'لا توجد تمييزات بعد',
    'highlights.color': 'لون التمييز',

    // Tags
    'tags.add': 'إضافة علامة',
    'tags.remove': 'إزالة العلامة',
    'tags.placeholder': 'اسم العلامة…',

    // AI
    'ai.title': 'مساعد الذكاء الاصطناعي',
    'ai.setup': 'إعداد الذكاء الاصطناعي',
    'ai.setup.description': 'اربط مزود ذكاء اصطناعي لتلخيص النسخ النصية وطرح أسئلة حولها.',
    'ai.provider': 'المزود',
    'ai.model': 'النموذج',
    'ai.apiKey': 'مفتاح API',
    'ai.apiKey.hint': 'مخزّن بدون تشفير في قاعدة بيانات الإضافة الخاصة. لا تستطيع المواقع والسكربتات قراءته. يمكن لأي شخص يستطيع قراءة ملف المتصفح أو تشغيل برامج بصلاحياتك الوصول إليه.',
    'ai.sessionOnly': 'نسيان المفتاح عند إغلاق المتصفح',
    'ai.test': 'اختبار الاتصال',
    'ai.test.success': 'الاتصال ناجح',
    'ai.test.failed': 'فشل الاتصال',
    'ai.summary': 'ملخص',
    'ai.takeaways': 'النقاط الرئيسية',
    'ai.chapters': 'الفصول',
    'ai.qa': 'اطرح سؤالاً',
    'ai.qa.placeholder': 'اسأل عن الفيديو…',
    'ai.generating': 'جاري التوليد…',
    'ai.cancel': 'إلغاء',
    'ai.cached': 'نتيجة مخزنة',
    'ai.consent': 'سيتم إرسال نص النسخة النصية إلى {provider}. هل تريد المتابعة؟',
    'ai.consent.firefox': 'ستنقل هذه الإضافة محتوى الموقع إلى {provider} لمعالجة الذكاء الاصطناعي.',
    'ai.strictMode': 'وضع التقييد المحلي مفعّل. فقط مزودو الذكاء الاصطناعي المحليون مسموح بهم.',
    'ai.error.auth': 'فشل المصادقة. تحقق من مفتاح API.',
    'ai.error.rateLimit': 'تم تجاوز الحد. حاول لاحقاً.',
    'ai.error.network': 'خطأ في الشبكة. تحقق من اتصالك.',
    'ai.error.cors': 'خطأ CORS. قد يحتاج المزود إذن مضيف.',
    'ai.error.originRejected': 'رفض الخادم مصدر الطلب.',
    'ai.error.model': 'خطأ في النموذج. جرب نموذجاً مختلفاً.',
    'ai.error.contextTooLarge': 'النسخة النصية طويلة جداً لهذا النموذج.',
    'ai.error.cancelled': 'تم إلغاء التوليد.',
    'ai.error.blockedStrict': 'محظور بواسطة وضع التقييد المحلي.',

    // Settings
    'settings.title': 'الإعدادات',
    'settings.theme': 'المظهر',
    'settings.theme.light': 'فاتح',
    'settings.theme.dark': 'داكن',
    'settings.theme.system': 'النظام',
    'settings.language': 'اللغة',
    'settings.strictMode': 'وضع التقييد المحلي',
    'settings.strictMode.description': 'حظر جميع طلبات الذكاء الاصطناعي عن بُعد. فقط النماذج المحلية (Ollama، LM Studio) والذكاء الاصطناعي المدمج في Chrome مسموح بها. لا يؤثر هذا على حركة صفحة YouTube أو تحديثات المتصفح.',
    'settings.diagnostics': 'نسخ التشخيصات',
    'settings.diagnostics.copied': 'تم نسخ التشخيصات',
    'settings.about': 'حول',
    'settings.version': 'الإصدار',
    'settings.backup': 'النسخ الاحتياطي والاستعادة',
    'settings.storage': 'التخزين',
    'settings.privacy': 'سياسة الخصوصية',
    'settings.inPlayerButton': 'إظهار الزر في مشغل YouTube',
    'settings.inPlayerButton.description': 'يضيف زر نسخ نصي إلى عناصر التحكم في مشغل YouTube. مغلق افتراضياً لتقليل الكشف.',

    // Permissions
    'permission.youtube.revoked': 'تم إزالة الوصول إلى YouTube',
    'permission.youtube.grant': 'منح الوصول إلى YouTube',
    'permission.ai.grant': 'منح الوصول إلى {origin}',

    // General
    'general.save': 'حفظ',
    'general.cancel': 'إلغاء',
    'general.delete': 'حذف',
    'general.close': 'إغلاق',
    'general.loading': 'جاري التحميل…',
    'general.error': 'خطأ',
    'general.retry': 'إعادة المحاولة',
    'general.confirm': 'تأكيد',
    'general.success': 'نجاح',
  },
} as const;

export type MessageKey = keyof (typeof messages)['en'];

/**
 * Get a translated message by key with optional substitutions.
 */
export function t(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const msg = messages[locale][key] ?? messages.en[key] ?? key;
  if (!params) return msg;

  return Object.entries(params).reduce<string>(
    (result, [k, v]) => result.replace(`{${k}}`, String(v)),
    msg
  );
}
