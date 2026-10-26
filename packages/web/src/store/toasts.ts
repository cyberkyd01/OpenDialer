import { create } from 'zustand';

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
  kind?: 'primary' | 'danger' | 'default';
}

export interface Toast {
  id: number;
  level: ToastLevel;
  message: string;
  title?: string;
  actions?: ToastAction[];
  /** ms; 0 = stays until dismissed */
  timeout: number;
}

interface ToastStore {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id' | 'timeout'> & { timeout?: number }) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let seq = 0;

export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq;
    const timeout = t.timeout ?? (t.actions?.length ? 0 : t.level === 'error' ? 8000 : 5000);
    set({ toasts: [...get().toasts.slice(-5), { ...t, id, timeout }] });
    if (timeout > 0) setTimeout(() => get().dismiss(id), timeout);
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  clear: () => set({ toasts: [] }),
}));

export const toast = {
  info: (message: string, title?: string) => useToasts.getState().push({ level: 'info', message, title }),
  success: (message: string, title?: string) => useToasts.getState().push({ level: 'success', message, title }),
  warning: (message: string, title?: string) => useToasts.getState().push({ level: 'warning', message, title }),
  error: (message: string, title?: string) => useToasts.getState().push({ level: 'error', message, title }),
};
