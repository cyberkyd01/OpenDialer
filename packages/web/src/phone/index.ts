import type { SipCredentials } from '@opendialer/shared';
import { SimPhone } from './SimPhone';
import type { Phone } from './types';

export * from './types';
export { SimPhone } from './SimPhone';

/** Create the right softphone for the server's telephony mode. sip.js is loaded lazily. */
export async function createPhone(creds: SipCredentials): Promise<Phone> {
  if (creds.mode === 'sip') {
    const { SipPhone } = await import('./SipPhone');
    return new SipPhone();
  }
  const sim = new SimPhone();
  // test / demo hook: window.__opendialerSim.setOutcomes(['answer', 'busy'])
  (globalThis as unknown as { __opendialerSim?: unknown }).__opendialerSim = {
    setOutcomes: SimPhone.setOutcomes,
    phone: sim,
  };
  return sim;
}
