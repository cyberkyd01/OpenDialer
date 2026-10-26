import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, apiUrl, errorMessage, request, setUnauthorizedHandler } from './api';
import { getToken, setServerUrl, setToken } from './config';

function mockFetch(status: number, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('errorMessage', () => {
  it('uses the server error string', () => {
    expect(errorMessage({ error: 'Campaign not found' }, 404)).toBe('Campaign not found');
  });
  it('appends zod validation details', () => {
    expect(
      errorMessage({ error: 'Validation failed', details: [{ path: 'name', message: 'Too small' }, { path: ['a', 'b'], message: 'Required' }] }, 400),
    ).toBe('Validation failed – name: Too small; a.b: Required');
  });
  it('falls back to the status for HTML or empty bodies', () => {
    expect(errorMessage('<html>oops</html>', 502, 'Bad Gateway')).toBe('Request failed (502 Bad Gateway)');
    expect(errorMessage(null, 500)).toBe('Request failed (500)');
    expect(errorMessage('Plain text problem', 400)).toBe('Plain text problem');
  });
});

describe('api client', () => {
  beforeEach(() => {
    localStorage.clear();
    setServerUrl('');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(() => {});
  });

  it('sends the bearer token and JSON body', async () => {
    setToken('tok123');
    const fetch = mockFetch(200, { ok: true });
    const r = await api.post<{ ok: boolean }>('/things', { a: 1 });
    expect(r).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/things');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer tok123');
    expect((init!.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init!.body).toBe('{"a":1}');
  });

  it('builds query strings and skips empty values', () => {
    expect(apiUrl('/leads', { q: 'jo hn', page: 2, status: '', listId: undefined, x: null })).toBe('/api/leads?q=jo+hn&page=2');
  });

  it('honours a configured server URL', () => {
    setServerUrl('https://dialer.example.com:8443/');
    expect(apiUrl('/health')).toBe('https://dialer.example.com:8443/api/health');
    setServerUrl('');
  });

  it('on 401 clears the token, calls the handler and throws ApiError', async () => {
    setToken('expired');
    const onUnauth = vi.fn();
    setUnauthorizedHandler(onUnauth);
    mockFetch(401, { error: 'Unauthorized' });
    const p = api.get('/auth/me');
    await expect(p).rejects.toBeInstanceOf(ApiError);
    await expect(api.get('/auth/me')).rejects.toMatchObject({ status: 401, message: 'Unauthorized' });
    expect(getToken()).toBeNull();
    expect(onUnauth).toHaveBeenCalled();
  });

  it('a 401 from the login form does not trigger the session-expired handler', async () => {
    const onUnauth = vi.fn();
    setUnauthorizedHandler(onUnauth);
    mockFetch(401, { error: 'Invalid username or password' });
    await expect(request('POST', '/auth/login', { body: {}, noAuthRedirect: true })).rejects.toMatchObject({ message: 'Invalid username or password' });
    expect(onUnauth).not.toHaveBeenCalled();
  });

  it('exposes validation details on the error', async () => {
    setToken('t');
    mockFetch(400, { error: 'Validation failed', details: [{ path: 'phone', message: 'Too short' }] });
    const err = (await api.post('/leads', {}).catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(400);
    expect(err.message).toBe('Validation failed – phone: Too short');
    expect(err.details).toEqual([{ path: 'phone', message: 'Too short' }]);
  });

  it('reports network failures in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(api.get('/health')).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/Cannot reach the server/) });
  });

  it('sends multipart forms without a JSON content-type', async () => {
    setToken('t');
    const fetch = mockFetch(201, { ok: true });
    const form = new FormData();
    form.append('file', new Blob(['a,b\n1,2']), 'x.csv');
    await api.upload('/lists/1/import/preview', form);
    const init = fetch.mock.calls[0][1]!;
    expect(init.body).toBe(form);
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
  });
});
