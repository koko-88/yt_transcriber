// Settings tab: theme, language, strict local mode, diagnostics.

import { usePanelStore } from '../store.js';
import { logger } from '../../core/logger.js';
import { useState } from 'react';

export function SettingsView() {
  const s = usePanelStore();
  const [copied, setCopied] = useState(false);

  return (
    <div className="view">
      <h2 style={{ margin: 0, fontSize: 15 }}>{s.tr('settings.title')}</h2>

      <div className="settings-row">
        <label htmlFor="set-theme">{s.tr('settings.theme')}</label>
        <select
          id="set-theme"
          value={s.settings.theme}
          onChange={(e) => {
            const theme = e.target.value as 'light' | 'dark' | 'system';
            document.documentElement.dataset.theme = theme === 'system' ? '' : theme;
            void s.updateSettings({ theme });
          }}
        >
          <option value="system">{s.tr('settings.theme.system')}</option>
          <option value="light">{s.tr('settings.theme.light')}</option>
          <option value="dark">{s.tr('settings.theme.dark')}</option>
        </select>
      </div>

      <div className="settings-row">
        <label htmlFor="set-locale">{s.tr('settings.language')}</label>
        <select
          id="set-locale"
          value={s.settings.locale}
          onChange={(e) => void s.updateSettings({ locale: e.target.value as 'system' | 'en' | 'ar' })}
        >
          <option value="system">System</option>
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </select>
      </div>

      <div className="settings-row">
        <label htmlFor="set-strict">{s.tr('settings.strictMode')}</label>
        <div className="hint">{s.tr('settings.strictMode.description')}</div>
        <label style={{ fontWeight: 400 }}>
          <input
            id="set-strict"
            type="checkbox"
            checked={s.settings.strictMode}
            onChange={(e) => void s.updateSettings({ strictMode: e.target.checked })}
          />{' '}
          {s.tr('settings.strictMode')}
        </label>
      </div>

      <div className="settings-row">
        <label>{s.tr('settings.diagnostics')}</label>
        <div>
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(logger.getDiagnostics()).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? s.tr('settings.diagnostics.copied') : s.tr('settings.diagnostics')}
          </button>
        </div>
      </div>

      <div className="settings-row">
        <label>{s.tr('settings.about')}</label>
        <div className="hint">
          {s.tr('app.name')} · {s.tr('settings.version')} 1.0.0
        </div>
      </div>
    </div>
  );
}
