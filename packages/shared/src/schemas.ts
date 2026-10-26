/**
 * Zod schemas for every request body. The server validates with these and the
 * web client reuses them for form validation so both sides agree.
 */
import { z } from 'zod';

export const roleSchema = z.enum(['admin', 'supervisor', 'agent']);
export const dialModeSchema = z.enum(['manual', 'preview', 'progressive']);
export const campaignStatusSchema = z.enum(['draft', 'active', 'paused', 'completed']);
export const recordingPolicySchema = z.enum(['off', 'always', 'agent']);
export const dispositionCategorySchema = z.enum(['contact', 'no_contact', 'callback', 'dnc', 'invalid']);
export const leadStatusSchema = z.enum(['new', 'in_progress', 'callback', 'done', 'dnc', 'invalid']);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
const ianaZone = z.string().min(1).max(64);

export const setupSchema = z.object({
  username: z.string().min(2).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'Letters, digits, . _ - only'),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(80),
  companyName: z.string().min(1).max(120).default('OpenDialer'),
  defaultCountry: z.string().length(2).default('US'),
  defaultTimezone: ianaZone.default('UTC'),
});

export const loginSchema = z.object({
  username: z.string().min(1).max(40),
  password: z.string().min(1).max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export const userCreateSchema = z.object({
  username: z.string().min(2).max(40).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(80),
  role: roleSchema.default('agent'),
  active: z.boolean().default(true),
  sipUsername: z.string().max(120).nullable().optional(),
  sipAuthUsername: z.string().max(120).nullable().optional(),
  sipPassword: z.string().max(200).nullable().optional(),
});

export const userUpdateSchema = userCreateSchema.partial().extend({
  password: z.string().min(8).max(200).optional(),
});

export const iceServerSchema = z.object({
  urls: z.string().min(1),
  username: z.string().optional(),
  credential: z.string().optional(),
});

export const telephonySettingsSchema = z.object({
  mode: z.enum(['sip', 'sim']).default('sim'),
  wssUrl: z.string().default(''),
  sipDomain: z.string().default(''),
  iceServers: z.array(iceServerSchema).default([{ urls: 'stun:stun.l.google.com:19302' }]),
  register: z.boolean().default(true),
  ringTimeoutSec: z.number().int().min(5).max(180).default(45),
});

export const settingsSchema = z.object({
  companyName: z.string().min(1).max(120),
  telephony: telephonySettingsSchema,
  defaultCountry: z.string().length(2),
  defaultTimezone: ianaZone,
  recordingConsentNotice: z.string().max(1000),
  pauseCodes: z.array(z.string().min(1).max(40)).max(50),
  maxAttemptsPerDay: z.number().int().min(0).max(100),
  requireConsentFlag: z.boolean(),
});
export const settingsUpdateSchema = settingsSchema
  .partial()
  .extend({ telephony: telephonySettingsSchema.partial().optional() });

export const campaignCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  dialMode: dialModeSchema.default('preview'),
  callerId: z.string().max(40).default(''),
  scriptId: z.number().int().nullable().default(null),
  callingHoursStart: hhmm.default('09:00'),
  callingHoursEnd: hhmm.default('20:00'),
  callingDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  timezoneMode: z.enum(['lead', 'fixed']).default('lead'),
  fixedTimezone: ianaZone.default('UTC'),
  maxAttempts: z.number().int().min(1).max(50).default(3),
  retryMinutes: z.number().int().min(1).max(10080).default(240),
  previewTimeoutSec: z.number().int().min(0).max(600).default(0),
  wrapupTimeoutSec: z.number().int().min(0).max(3600).default(0),
  recording: recordingPolicySchema.default('agent'),
  dialPrefix: z.string().max(10).default(''),
});
export const campaignUpdateSchema = campaignCreateSchema.partial();
export const campaignStatusUpdateSchema = z.object({ status: campaignStatusSchema });
export const campaignAgentsSchema = z.object({ userIds: z.array(z.number().int()) });

export const listCreateSchema = z.object({
  name: z.string().min(1).max(120),
  active: z.boolean().default(true),
});
export const listUpdateSchema = listCreateSchema.partial();

export const leadCreateSchema = z.object({
  listId: z.number().int(),
  phone: z.string().min(3).max(40),
  firstName: z.string().max(80).default(''),
  lastName: z.string().max(80).default(''),
  company: z.string().max(120).default(''),
  email: z.string().max(160).default(''),
  timezone: ianaZone.nullable().default(null),
  custom: z.record(z.string(), z.string()).default({}),
  priority: z.number().int().min(0).max(100).default(0),
  notes: z.string().max(5000).default(''),
});

export const leadUpdateSchema = z.object({
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  company: z.string().max(120).optional(),
  email: z.string().max(160).optional(),
  phone: z.string().min(3).max(40).optional(),
  timezone: ianaZone.nullable().optional(),
  custom: z.record(z.string(), z.string()).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  notes: z.string().max(5000).optional(),
  status: leadStatusSchema.optional(),
  nextAttemptAt: z.string().nullable().optional(),
  attempts: z.number().int().min(0).optional(),
});

/** Column mapping for CSV import: csv header -> lead field. */
export const importMappingSchema = z.object({
  phone: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  email: z.string().optional(),
  timezone: z.string().optional(),
  priority: z.string().optional(),
  notes: z.string().optional(),
  /** every other column goes to custom */
  customColumns: z.array(z.string()).default([]),
  skipDnc: z.boolean().default(true),
  dedupeAgainst: z.enum(['list', 'campaign', 'none']).default('campaign'),
});

export const dispositionCreateSchema = z.object({
  code: z.string().min(1).max(20).regex(/^[A-Z0-9_]+$/, 'UPPERCASE_CODE'),
  label: z.string().min(1).max(80),
  category: dispositionCategorySchema,
  retryMinutes: z.number().int().min(1).max(43200).nullable().default(null),
  countsAsContact: z.boolean().default(false),
  isSale: z.boolean().default(false),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#64748b'),
  sortOrder: z.number().int().default(100),
});
export const dispositionUpdateSchema = dispositionCreateSchema.partial();

export const dncCreateSchema = z.object({
  phone: z.string().min(3).max(40),
  note: z.string().max(500).default(''),
});

export const scriptCreateSchema = z.object({
  name: z.string().min(1).max(120),
  body: z.string().max(50000).default(''),
});
export const scriptUpdateSchema = scriptCreateSchema.partial();

export const callbackUpdateSchema = z.object({
  scheduledAt: z.string().optional(),
  note: z.string().max(2000).optional(),
  status: z.enum(['pending', 'done', 'cancelled']).optional(),
  userId: z.number().int().nullable().optional(),
});

export const webhookCreateSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().max(200).default(''),
  active: z.boolean().default(true),
});
export const webhookUpdateSchema = webhookCreateSchema.partial();

export const apiKeyCreateSchema = z.object({ name: z.string().min(1).max(80) });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

export type SetupInput = z.infer<typeof setupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;
export type CampaignUpdateInput = z.infer<typeof campaignUpdateSchema>;
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;
export type ImportMapping = z.infer<typeof importMappingSchema>;
export type DispositionCreateInput = z.infer<typeof dispositionCreateSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type WebhookCreateInput = z.infer<typeof webhookCreateSchema>;
