import type { Lead } from './types.js';

export interface ScriptContext {
  lead?: Partial<Lead> | null;
  agentName?: string;
  companyName?: string;
  extra?: Record<string, string>;
}

const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

/**
 * Replace {{placeholders}} in a call script. Supported keys (case-insensitive,
 * camelCase or snake_case): first_name, last_name, full_name, company, email,
 * phone, agent_name, company_name, custom.<field>, and anything in `extra`.
 * Unknown placeholders render as an empty string.
 */
export function renderScript(body: string, ctx: ScriptContext): string {
  const lead = ctx.lead ?? {};
  const vars = new Map<string, string>();
  const put = (k: string, v: unknown) => {
    const s = v == null ? '' : String(v);
    vars.set(k.toLowerCase(), s);
    vars.set(toSnake(k).toLowerCase(), s);
  };
  put('firstName', lead.firstName);
  put('lastName', lead.lastName);
  put('fullName', [lead.firstName, lead.lastName].filter(Boolean).join(' '));
  put('company', lead.company);
  put('email', lead.email);
  put('phone', lead.phone);
  put('agentName', ctx.agentName);
  put('companyName', ctx.companyName);
  for (const [k, v] of Object.entries(lead.custom ?? {})) put(`custom.${k}`, v);
  for (const [k, v] of Object.entries(ctx.extra ?? {})) put(k, v);
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => vars.get(key.toLowerCase()) ?? '');
}

/** The placeholder names a script author may use (for UI hints). */
export const SCRIPT_PLACEHOLDERS = [
  'first_name',
  'last_name',
  'full_name',
  'company',
  'email',
  'phone',
  'agent_name',
  'company_name',
  'custom.<field>',
];
