import { describe, it, expect } from 'vitest';
import { t, getDirection, messages } from '../src/core/i18n';
import { hashText, segmentsToText } from '../src/core/hash';
import { Secret } from '../src/core/secret';

describe('i18n', () => {
  it('interpolates params', () => {
    expect(t('en', 'transcript.segments', { count: 5 })).toBe('5 segments');
  });

  it('has Arabic translations for every English key', () => {
    const enKeys = Object.keys(messages.en);
    const arKeys = new Set(Object.keys(messages.ar));
    const missing = enKeys.filter((k) => !arKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('resolves direction', () => {
    expect(getDirection('en')).toBe('ltr');
    expect(getDirection('ar')).toBe('rtl');
  });
});

describe('hash', () => {
  it('is deterministic', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
  });

  it('segmentsToText joins text only', () => {
    const s = segmentsToText([{ text: 'a' }, { text: 'b' }]);
    expect(s).toContain('a');
    expect(s).toContain('b');
  });
});

describe('Secret', () => {
  it('redacts in toString and JSON', () => {
    const s = new Secret('super-secret-key');
    expect(String(s)).toBe('[redacted]');
    expect(JSON.stringify({ key: s })).toBe('{"key":"[redacted]"}');
    expect(s.expose()).toBe('super-secret-key');
  });

  it('Secret.from returns null for empty values', () => {
    expect(Secret.from('')).toBeNull();
    expect(Secret.from('  ')).toBeNull();
    expect(Secret.from(null)).toBeNull();
    expect(Secret.from('k')!.expose()).toBe('k');
  });
});
