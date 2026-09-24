// Library tab: recents list with open/remove.

import { usePanelStore } from '../store.js';

export function LibraryView() {
  const s = usePanelStore();

  if (s.recents.length === 0) {
    return (
      <div className="view">
        <div className="banner">
          <strong>{s.tr('library.empty')}</strong>
          <div>{s.tr('library.empty.hint')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="view">
      <h2 style={{ margin: 0, fontSize: 15 }}>{s.tr('library.recents')}</h2>
      {s.recents.map((item) => (
        <div key={item.transcriptId} style={{ display: 'flex', gap: 6 }}>
          <button className="library-item" onClick={() => void s.openSaved(item.transcriptId)}>
            {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" loading="lazy" />}
            <span style={{ minWidth: 0 }}>
              <span className="title">{item.title}</span>
              <span className="sub" style={{ display: 'block' }}>
                {item.channelName ?? item.videoId} · {item.languageCode} ·{' '}
                {s.tr('transcript.segments', { count: item.segmentCount })}
              </span>
            </span>
          </button>
          <button
            className="btn"
            aria-label={s.tr('library.unsave')}
            title={s.tr('library.unsave')}
            onClick={() => void s.removeFromLibrary(item.transcriptId)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
