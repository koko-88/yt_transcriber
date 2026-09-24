// AI tab: provider config, key management, consent, pipelines, Q&A.
// Privacy rules per plan: consent before first send, explicit user action
// per run, API key input is type=password with autocomplete=off.

import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { usePanelStore } from '../store.js';
import { bus } from '../../platform/messaging.js';
import type { AiPipeline, AiRunRequest, AiRunResult } from '../../ai/types.js';

interface ProviderInfo {
  id: string;
  label: string;
  defaultModel: string;
  requiresKey: boolean;
  isLocal: boolean;
  originPattern: string;
}

type Status = { tone: 'info' | 'error'; text: string } | null;

export function AiView() {
  const s = usePanelStore();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState(s.settings.aiProvider);
  const [model, setModel] = useState(s.settings.aiModel);
  const [apiKey, setApiKey] = useState('');
  const [sessionOnly, setSessionOnly] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<{ text: string; meta: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [needsConsent, setNeedsConsent] = useState(false);
  const pendingPipeline = useRef<AiPipeline | null>(null);

  const provider = providers.find((p) => p.id === providerId) ?? null;

  useEffect(() => {
    void bus.request<ProviderInfo[]>('ai.providers').then(setProviders);
  }, []);

  useEffect(() => {
    setResult(null);
    setNeedsConsent(false);
    setStatus(null);
    if (provider) {
      setModel(provider.defaultModel);
      void bus
        .request<{ has: boolean }>('ai.secret.has', { providerId: provider.id })
        .then((r) => setHasKey(r.has));
    }
  }, [providerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ensurePermission = async (): Promise<boolean> => {
    if (!provider) return false;
    return browser.permissions.request({ origins: [provider.originPattern] });
  };

  const saveKey = async () => {
    if (!provider) return;
    await bus.request('ai.secret.set', { providerId: provider.id, key: apiKey, sessionOnly });
    setHasKey(apiKey.trim().length > 0);
    setApiKey('');
    setStatus({ tone: 'info', text: s.tr('general.success') });
  };

  const testConnection = async () => {
    if (!provider) return;
    setBusy(true);
    setStatus(null);
    try {
      if (!(await ensurePermission())) {
        setStatus({ tone: 'error', text: s.tr('ai.error.cors') });
        return;
      }
      const r = await bus.request<AiRunResult>('ai.test', { providerId: provider.id, model });
      setStatus(
        r.ok
          ? { tone: 'info', text: s.tr('ai.test.success') }
          : { tone: 'error', text: s.tr('ai.test.failed') },
      );
    } finally {
      setBusy(false);
    }
  };

  const runPipeline = async (pipeline: AiPipeline, consent = false) => {
    if (!provider || !s.transcript || busy) return;
    setBusy(true);
    setStatus(null);
    setNeedsConsent(false);
    try {
      // Persist transcript so the background can load it by ID.
      await bus.request('library.save', { transcript: s.transcript });
      const request: AiRunRequest = {
        pipeline,
        transcriptId: s.transcript.id,
        providerId: provider.id,
        model,
        ...(pipeline === 'qa' ? { question } : {}),
      };
      const r = await bus.request<AiRunResult>('ai.run', { request, consent });
      if (r.ok) {
        setResult({
          text: r.text ?? '',
          meta: `${s.tr('ai.provider')}: ${r.provider} Â· ${s.tr('ai.model')}: ${r.model}`,
        });
      } else if (r.errorCode === 'AI_CONSENT_REQUIRED') {
        setNeedsConsent(true);
        pendingPipeline.current = pipeline;
      } else if (r.errorCode === 'AI_PERMISSION_DENIED') {
        setStatus({ tone: 'error', text: s.tr('ai.error.cors') });
      } else if (r.errorCode === 'AI_NO_KEY') {
        setStatus({ tone: 'error', text: s.tr('ai.error.auth') });
      } else if (r.errorCode === 'AI_BLOCKED_STRICT') {
        setStatus({ tone: 'error', text: s.tr('ai.error.blockedStrict') });
      } else {
        setStatus({
          tone: 'error',
          text: String(s.tr('ai.error.network')) + ' ' + (r.errorMessage ?? r.errorCode ?? ''),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const consentAndRun = async () => {
    if (!(await ensurePermission())) {
      setStatus({ tone: 'error', text: s.tr('ai.error.cors') });
      setNeedsConsent(false);
      return;
    }
    const pending = pendingPipeline.current;
    pendingPipeline.current = null;
    if (pending) await runPipeline(pending, true);
  };

  const canRun = !!s.transcript && !busy && !!provider;
  const pipelines: { id: AiPipeline; key: 'ai.summary' | 'ai.takeaways' | 'ai.chapters' }[] = [
    { id: 'summary', key: 'ai.summary' },
    { id: 'takeaways', key: 'ai.takeaways' },
    { id: 'chapters', key: 'ai.chapters' },
  ];

  return (
    <div className="view">
      <h2 style={{ margin: 0, fontSize: 15 }}>{s.tr('ai.title')}</h2>

      <div className="settings-row">
        <label htmlFor="ai-provider">{s.tr('ai.provider')}</label>
        <select
          id="ai-provider"
          value={providerId}
          onChange={(e) => {
            setProviderId(e.target.value);
            void s.updateSettings({ aiProvider: e.target.value });
          }}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-row">
        <label htmlFor="ai-model">{s.tr('ai.model')}</label>
        <input
          id="ai-model"
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onBlur={() => void s.updateSettings({ aiModel: model })}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {provider?.requiresKey && (
        <div className="settings-row ai-config">
          <label htmlFor="ai-key">{s.tr('ai.apiKey')}</label>
          <div className="hint">{s.tr('ai.apiKey.hint')}</div>
          <input
            id="ai-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
            placeholder={hasKey ? '********' : ''}
          />
          <label style={{ fontWeight: 400 }}>
            <input
              type="checkbox"
              checked={sessionOnly}
              onChange={(e) => setSessionOnly(e.target.checked)}
            />{' '}
            {s.tr('ai.sessionOnly')}
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={() => void saveKey()} disabled={!apiKey.trim()}>
              {s.tr('general.save')}
            </button>
            {hasKey && (
              <button
                className="btn"
                onClick={() => {
                  void bus
                    .request('ai.secret.delete', { providerId: provider.id })
                    .then(() => setHasKey(false));
                }}
              >
                {s.tr('general.delete')}
              </button>
            )}
            <button className="btn" onClick={() => void testConnection()} disabled={busy}>
              {s.tr('ai.test')}
            </button>
          </div>
        </div>
      )}

      <div className="settings-row">
        <div className="hint">{s.tr('ai.setup.description')}</div>
      </div>

      {needsConsent && (
        <div className="banner" data-tone="error">
          <div>{s.tr('ai.consent', { provider: provider?.label ?? '' })}</div>
          <button className="btn primary" style={{ marginBlockStart: 8 }} onClick={() => void consentAndRun()}>
            {s.tr('general.confirm')}
          </button>
        </div>
      )}

      {!s.transcript && <div className="banner">{s.tr('availability.not-a-video-page')}</div>}

      <div className="toolbar">
        {pipelines.map((p) => (
          <button key={p.id} className="btn" disabled={!canRun} onClick={() => void runPipeline(p.id)}>
            {s.tr(p.key)}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder={s.tr('ai.qa.placeholder')}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && question.trim()) void runPipeline('qa');
          }}
        />
        <button className="btn" disabled={!canRun || !question.trim()} onClick={() => void runPipeline('qa')}>
          {s.tr('ai.qa')}
        </button>
      </div>

      {busy && (
        <div className="banner">
          <span className="spinner" />
          {s.tr('ai.generating')}
        </div>
      )}

      {status && <div className="banner" data-tone={status.tone === 'error' ? 'error' : undefined}>{status.text}</div>}

      {result && (
        <div className="banner" style={{ whiteSpace: 'pre-wrap' }}>
          <div className="hint" style={{ marginBlockEnd: 6 }}>
            {result.meta}
            {' Â· '}
            <button className="btn" onClick={() => void navigator.clipboard.writeText(result.text)}>
              {s.tr('transcript.copy.text')}
            </button>
          </div>
          {result.text}
        </div>
      )}
    </div>
  );
}