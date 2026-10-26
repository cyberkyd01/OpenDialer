import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export interface NormalizedPhone {
  /** E.164 (e.g. +14155552671) or null when the number cannot be parsed */
  e164: string | null;
  valid: boolean;
  country: string | null;
  national: string | null;
}

/**
 * Normalise anything a human typed into E.164. Accepts national numbers using
 * `defaultCountry`, strips punctuation and common prefixes ("tel:", "p:").
 */
export function normalizePhone(raw: string, defaultCountry = 'US'): NormalizedPhone {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/^(tel:|phone:|p:)/i, '')
    .replace(/[^\d+()\-.\s]/g, '')
    .trim();
  if (!cleaned) return { e164: null, valid: false, country: null, national: null };
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry.toUpperCase() as CountryCode);
  if (!parsed) return { e164: null, valid: false, country: null, national: null };
  return {
    e164: parsed.number,
    valid: parsed.isValid(),
    country: parsed.country ?? null,
    national: parsed.formatNational(),
  };
}

/** Pretty-print an E.164 number for display; falls back to the input. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === 'US' || parsed.country === 'CA'
    ? parsed.formatNational()
    : parsed.formatInternational();
}

/** Digits only, used for DNC wildcard matching and dedupe keys. */
export function phoneDigits(phone: string): string {
  return String(phone ?? '').replace(/\D/g, '');
}
