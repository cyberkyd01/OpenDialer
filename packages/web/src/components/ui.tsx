import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { describeError } from '../lib/api';

/* ------------------------------------------------------------------ */
/* data loading                                                        */
/* ------------------------------------------------------------------ */

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await fnRef.current();
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (err) {
      if (my === seq.current) setError(describeError(err));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, setData, error, loading, reload };
}

/** Re-render every `ms` and return Date.now(). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Run an async action with a busy flag and error capture. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(describeError(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

/* ------------------------------------------------------------------ */
/* small components                                                    */
/* ------------------------------------------------------------------ */

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" role="status">
      <span className="spinner" aria-hidden="true" />
      {label && <span className="muted">{label}</span>}
    </span>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="center-screen">
      <Spinner label={label} />
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string | null | undefined; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="alert error row between" role="alert">
      <span>{error}</span>
      {onRetry && (
        <button type="button" className="btn small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className ?? ''}`}>
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="error">{error}</span>}
    </label>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
  drawer,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  drawer?: boolean;
  footer?: ReactNode;
}) {
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={`overlay ${drawer ? 'drawer' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="modal-header">
          <h2 id={id} style={{ margin: 0 }}>
            {title}
          </h2>
          <button type="button" className="btn ghost icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
        {footer && <div className="form-actions">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" className="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <span className="muted small">
        {total} total · page {page} / {pages}
      </span>
      <button type="button" className="btn small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ‹ Prev
      </button>
      <button type="button" className="btn small" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next ›
      </button>
    </div>
  );
}

export function StateBadge({ state, label }: { state: string; label?: string }) {
  return <span className={`badge state-badge state-${state}`}>{label ?? state}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* confirm / prompt dialogs (promise based)                            */
/* ------------------------------------------------------------------ */

interface DialogReq {
  kind: 'confirm' | 'prompt';
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  placeholder?: string;
  initial?: string;
  resolve: (v: string | boolean | null) => void;
}

const useDialogs = create<{ current: DialogReq | null }>(() => ({ current: null }));

export function confirmDialog(opts: { title: string; message?: ReactNode; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogs.setState({ current: { kind: 'confirm', ...opts, resolve: (v) => resolve(Boolean(v)) } });
  });
}

export function promptDialog(opts: { title: string; message?: ReactNode; confirmLabel?: string; placeholder?: string; initial?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogs.setState({ current: { kind: 'prompt', ...opts, resolve: (v) => resolve(typeof v === 'string' ? v : null) } });
  });
}

export function DialogHost() {
  const req = useDialogs((s) => s.current);
  const [value, setValue] = useState('');
  useEffect(() => setValue(req?.initial ?? ''), [req]);
  if (!req) return null;
  const close = (v: string | boolean | null) => {
    useDialogs.setState({ current: null });
    req.resolve(v);
  };
  return (
    <Modal title={req.title} onClose={() => close(req.kind === 'confirm' ? false : null)}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          close(req.kind === 'confirm' ? true : value.trim());
        }}
      >
        {req.message && <div>{req.message}</div>}
        {req.kind === 'prompt' && (
          <input autoFocus value={value} placeholder={req.placeholder} onChange={(e) => setValue(e.target.value)} aria-label={req.title} />
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => close(req.kind === 'confirm' ? false : null)}>
            Cancel
          </button>
          <button type="submit" className={`btn ${req.danger ? 'danger' : 'primary'}`} autoFocus={req.kind === 'confirm'} disabled={req.kind === 'prompt' && !value.trim()}>
            {req.confirmLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
