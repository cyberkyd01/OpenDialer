import { renderScript, type Lead } from '@opendialer/shared';
import { ScriptMarkup } from '../lib/scriptMarkup';

/** Render a call script with the lead's placeholders filled in. */
export function ScriptView({ body, lead, agentName, companyName }: { body: string; lead?: Partial<Lead> | null; agentName?: string; companyName?: string }) {
  const text = renderScript(body, { lead: lead ?? null, agentName, companyName });
  return <ScriptMarkup text={text} />;
}
