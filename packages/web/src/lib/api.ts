import { getServerUrl, getToken, setToken } from './config';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Turn a server error body into a human message ("Validation failed – name: Required"). */
export function errorMessage(body: unknown, status: number, statusText = ''): string {
  if (body && typeof body === 'object') {
    const b = body as { error?: unknown; message?: unknown; details?: unknown };
    let msg = typeof b.error === 'string' ? b.error : typeof b.message === 'string' ? b.message : '';
    if (Array.isArray(b.details) && b.details.length) {
      const parts = b.details
        .map((d) => {
          if (!d || typeof d !== 'object') return String(d);
          const dd = d as { path?: unknown; message?: unknown };
          const p = Array.isArray(dd.path) ? dd.path.join('.') : String(dd.path ?? '');
          return p ? `${p}: ${String(dd.message ?? '')}` : String(dd.message ?? '');
        })
        .filter(Boolean);
      if (parts.length) msg = `${msg || 'Error'} – ${parts.join('; ')}`;
    }
    if (msg) return msg;
  }
  if (typeof body === 'string' && body.trim() && body.length < 300 && !body.trim().startsWith('<')) return body.trim();
  return `Request failed (${status}${statusText ? ' ' + statusText : ''})`;
}

/** Best-effort message from anything thrown. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Something went wrong';
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** multipart form; mutually exclusive with body */
  form?: FormData;
  signal?: AbortSignal;
  /** return the raw Response (downloads, audio) */
  raw?: boolean;
  /** do not treat a 401 as "session expired" (login form) */
  noAuthRedirect?: boolean;
}

export function apiUrl(path: string, query?: Query): string {
  const base = getServerUrl() + '/api' + (path.startsWith('/') ? path : '/' + path);
  if (!query) return base;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

export async function request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path, opts.query), { method, headers, body, signal: opts.signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the server – check the connection');
  }
  if (res.status === 401 && !opts.noAuthRedirect && token) {
    setToken(null);
    onUnauthorized();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not json */
    }
    const details = parsed && typeof parsed === 'object' ? (parsed as { details?: unknown }).details : undefined;
    throw new ApiError(res.status, errorMessage(parsed, res.status, res.statusText), details);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, { form }),
  raw: (path: string, query?: Query) => request<Response>('GET', path, { query, raw: true }),
};

/** Fetch with auth and hand the result to the browser as a file download (links cannot carry the header). */
export async function downloadFile(path: string, query: Query | undefined, fallbackName: string) {
  const res = await api.raw(path, query);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename="?([^";]+)"?/i.exec(cd);
  const name = m?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Fetch a binary resource with auth and return an object URL (audio players). */
export async function blobUrl(path: string): Promise<string> {
  const res = await api.raw(path);
  return URL.createObjectURL(await res.blob());
}
