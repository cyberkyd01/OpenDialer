import { create } from 'zustand';
import type { PublicSettings, Role, Settings, User } from '@opendialer/shared';
import { api, request } from '../lib/api';
import { getToken, setToken } from '../lib/config';

interface AuthStore {
  token: string | null;
  user: User | null;
  settings: Settings | null;
  publicSettings: PublicSettings | null;
  /** null = not checked yet */
  serverError: string | null;
  booted: boolean;
  boot: () => Promise<void>;
  loadPublic: () => Promise<PublicSettings | null>;
  login: (username: string, password: string) => Promise<User>;
  acceptSession: (token: string, user: User) => Promise<void>;
  refreshMe: () => Promise<void>;
  setSettings: (s: Settings) => void;
  logout: () => void;
  /** called by the API layer on 401 */
  expire: () => void;
}

export const useAuth = create<AuthStore>((set, get) => ({
  token: getToken(),
  user: null,
  settings: null,
  publicSettings: null,
  serverError: null,
  booted: false,

  boot: async () => {
    await get().loadPublic();
    if (getToken()) {
      try {
        await get().refreshMe();
      } catch {
        /* expired / unreachable – login page */
      }
    }
    set({ booted: true });
  },

  loadPublic: async () => {
    try {
      const p = await api.get<PublicSettings>('/settings/public');
      set({ publicSettings: p, serverError: null });
      return p;
    } catch (err) {
      set({ serverError: (err as Error).message });
      return null;
    }
  },

  login: async (username, password) => {
    const r = await request<{ token: string; user: User }>('POST', '/auth/login', { body: { username, password }, noAuthRedirect: true });
    await get().acceptSession(r.token, r.user);
    return r.user;
  },

  acceptSession: async (token, user) => {
    setToken(token);
    set({ token, user });
    await get().refreshMe();
  },

  refreshMe: async () => {
    const me = await api.get<{ user: User; settings: Settings | null }>('/auth/me');
    set({ user: me.user, settings: me.settings, token: getToken() });
  },

  setSettings: (s) => set({ settings: s }),

  logout: () => {
    setToken(null);
    set({ token: null, user: null, settings: null });
  },

  expire: () => {
    if (!get().token && !get().user) return;
    set({ token: null, user: null, settings: null });
  },
}));

const RANK: Record<Role, number> = { agent: 1, supervisor: 2, admin: 3 };
export const hasRole = (user: Pick<User, 'role'> | null | undefined, min: Role) => Boolean(user && RANK[user.role] >= RANK[min]);
