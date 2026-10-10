import { z } from 'zod';
import { AuthClient, ApiError } from '../auth/client';
export const scopes = ['RECIPIENT_DETAILS', 'EMERGENCY_CONTACTS', 'ASSISTANCE_NOTES'] as const;
export const policySchema = z.object({
  noticeVersion: z.string(),
  notice: z.string(),
  development: z.boolean(),
});
export const profileSchema = z.object({
  id: z.uuid().nullable(),
  version: z.number(),
  displayName: z.string(),
  preferredLanguage: z.string(),
  maskedPhone: z.string(),
  policy: policySchema,
});
export const addressSchema = z.object({
  id: z.uuid(),
  version: z.number(),
  label: z.string(),
  line1: z.string(),
  line2: z.string(),
  locality: z.string(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  country: z.literal('IN'),
  point: z
    .object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]) })
    .nullable(),
});
export const recipientSchema = z.object({
  id: z.uuid(),
  version: z.number(),
  displayName: z.string(),
  relationship: z.string(),
  adult: z.literal(true),
  preferredLanguage: z.string(),
  communicationNeeds: z.string(),
  state: z.string(),
  sharingFrozen: z.boolean(),
  role: z.enum(['STEWARD', 'EDITOR', 'VIEWER']),
  consentScopes: z.array(z.enum(scopes)),
  consentExpiresAt: z.string().nullable(),
  assistanceNotes: z.string().optional(),
});
export const contactSchema = z.object({
  id: z.uuid(),
  version: z.number(),
  displayName: z.string(),
  relationship: z.string(),
  maskedPhone: z.string(),
});
export const memberSchema = z.object({
  id: z.uuid(),
  version: z.number(),
  role: z.string(),
  status: z.string(),
  scopes: z.array(z.enum(scopes)),
  identityLabel: z.string(),
});
export const invitationSchema = z.object({
  id: z.uuid(),
  version: z.number(),
  role: z.string(),
  status: z.string(),
  scopes: z.array(z.enum(scopes)),
  maskedPhone: z.string(),
  expiresAt: z.string(),
});
export const consentSchema = z.object({
  state: z.string(),
  sharingFrozen: z.boolean(),
  scopes: z.array(z.enum(scopes)),
  expiresAt: z.string().nullable(),
  noticeVersion: z.string(),
  nextStep: z.string(),
  case: z
    .object({
      id: z.uuid(),
      version: z.number(),
      state: z.string(),
      kind: z.string(),
      reasonCode: z.string().nullable(),
      expiresAt: z.string(),
    })
    .nullable(),
});
export const activitySchema = z.object({
  id: z.uuid(),
  action: z.string(),
  resourceId: z.string(),
  createdAt: z.string(),
});
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
export type Recipient = z.infer<typeof recipientSchema>;
export type Address = z.infer<typeof addressSchema>;
export type Contact = z.infer<typeof contactSchema>;
export class FamilyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(
      code === 'RECENT_MFA_REQUIRED'
        ? 'Sign in again with your authenticator to continue.'
        : status === 403
          ? 'You do not have permission for this record or invitation.'
          : status === 404
            ? 'This record is unavailable or access has been removed.'
            : status === 409
              ? 'This record changed or a request already exists. Refresh before trying again.'
              : status === 410
                ? 'This invitation has expired. Ask the steward for a new one.'
                : status === 422
                  ? 'Consent or the current review state does not allow this action.'
                  : status === 429
                    ? 'Too many requests. Wait before trying again.'
                    : status === 400
                      ? 'Check the fields, phone format and required choices.'
                      : status === 503
                        ? 'Family records are temporarily unavailable. Try again shortly.'
                        : 'Unable to connect. Check your connection and retry.',
    );
  }
}
// This UUID only deduplicates requests; it is never an authentication credential.
function requestKey() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const n = Math.floor(Math.random() * 16);
    return (c === 'x' ? n : (n & 3) | 8).toString(16);
  });
}
export class FamilyClient {
  private retry: { fingerprint: string; key: string } | null = null;
  constructor(private readonly auth: AuthClient) {}
  async call<T>(path: string, schema: z.ZodType<T>, method = 'GET', body?: unknown): Promise<T> {
    const fingerprint = JSON.stringify([path, method, body]);
    const key =
      method === 'GET'
        ? null
        : this.retry?.fingerprint === fingerprint
          ? this.retry.key
          : requestKey();
    if (key) this.retry = { fingerprint, key };
    try {
      const response = await this.auth.familyRequest(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: key ? { 'Idempotency-Key': key } : {},
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (response.status !== 503) this.retry = null;
        throw new FamilyError(
          response.status,
          typeof data?.code === 'string' ? data.code : 'REQUEST_FAILED',
        );
      }
      const result = schema.safeParse(await response.json());
      if (!result.success) throw new FamilyError(503, 'INVALID_RESPONSE');
      if (key) this.retry = null;
      return result.data;
    } catch (error) {
      if (error instanceof ApiError || error instanceof FamilyError) throw error;
      throw new FamilyError(0, 'NETWORK_ERROR');
    }
  }
}
