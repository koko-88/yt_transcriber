// Availability enum and acquisition result types
// Covers all states a transcript can be in per plan section 12

import type { Transcript, TranscriptTrack } from './model';

/** All possible availability/error states */
export type Availability =
  | 'available'
  | 'no-captions'
  | 'login-required'
  | 'age-restricted'
  | 'members-only'
  | 'live-in-progress'
  | 'upcoming'
  | 'not-a-video-page'
  | 'fetch-empty'
  | 'needs-player-interaction'
  | 'parse-failed'
  | 'unsupported-page-structure'
  | 'network-error'
  | 'unknown';

/** Diagnostic information from an acquisition stage */
export interface StageTrace {
  readonly stage: string;
  readonly method: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error?: string | undefined;
  readonly httpStatus?: number | undefined;
}

/** Successful acquisition */
export interface AcquisitionSuccess {
  readonly ok: true;
  readonly transcript: Transcript;
  readonly tracks: readonly TranscriptTrack[];
}

/** Failed acquisition — never contains transcript data */
export interface AcquisitionFailure {
  readonly ok: false;
  readonly reason: Availability;
  readonly retryable: boolean;
  readonly diagnostics: readonly StageTrace[];
}

/** The result of attempting to acquire a transcript */
export type AcquisitionResult = AcquisitionSuccess | AcquisitionFailure;

/** User-facing messages for each availability state */
export const AVAILABILITY_MESSAGES: Record<Availability, { en: string; ar: string }> = {
  available: { en: 'Transcript available', ar: 'النسخة النصية متاحة' },
  'no-captions': {
    en: 'No captions available for this video',
    ar: 'لا تتوفر تعليقات توضيحية لهذا الفيديو',
  },
  'login-required': {
    en: 'Sign in to YouTube to view this transcript',
    ar: 'سجّل الدخول إلى YouTube لعرض هذه النسخة النصية',
  },
  'age-restricted': {
    en: 'This video is age-restricted',
    ar: 'هذا الفيديو مقيد بالعمر',
  },
  'members-only': {
    en: 'This video is for channel members only',
    ar: 'هذا الفيديو لأعضاء القناة فقط',
  },
  'live-in-progress': {
    en: 'Live streams are not supported yet',
    ar: 'البث المباشر غير مدعوم بعد',
  },
  upcoming: {
    en: 'This video has not premiered yet',
    ar: 'لم يتم عرض هذا الفيديو بعد',
  },
  'not-a-video-page': {
    en: 'Navigate to a YouTube video to see its transcript',
    ar: 'انتقل إلى فيديو YouTube لعرض النسخة النصية',
  },
  'fetch-empty': {
    en: 'Captions exist but returned empty data. Try reloading the page.',
    ar: 'التعليقات موجودة لكنها أعادت بيانات فارغة. حاول إعادة تحميل الصفحة.',
  },
  'needs-player-interaction': {
    en: 'Play the video or enable captions to load the transcript',
    ar: 'شغّل الفيديو أو فعّل التعليقات لتحميل النسخة النصية',
  },
  'parse-failed': {
    en: 'Failed to parse the caption data',
    ar: 'فشل في تحليل بيانات التعليقات',
  },
  'unsupported-page-structure': {
    en: 'YouTube page structure has changed. Check for extension updates.',
    ar: 'تغير هيكل صفحة YouTube. تحقق من تحديثات الإضافة.',
  },
  'network-error': {
    en: 'Network error while loading captions',
    ar: 'خطأ في الشبكة أثناء تحميل التعليقات',
  },
  unknown: {
    en: 'An unexpected error occurred',
    ar: 'حدث خطأ غير متوقع',
  },
};
