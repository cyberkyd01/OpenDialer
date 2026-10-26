import { useToasts } from '../store/toasts';

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`} role={t.level === 'error' ? 'alert' : 'status'} data-testid="toast">
          <div className="toast-body">
            {t.title && <div className="toast-title">{t.title}</div>}
            <div>{t.message}</div>
            {t.actions && t.actions.length > 0 && (
              <div className="row" style={{ marginTop: '0.4rem' }}>
                {t.actions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    className={`btn small ${a.kind === 'primary' ? 'primary' : a.kind === 'danger' ? 'danger' : ''}`}
                    onClick={() => {
                      dismiss(t.id);
                      a.onClick();
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="btn ghost small icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
