import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { z } from 'zod';
import { AuthClient, ApiError } from '../auth/client';
import { tokens } from '../theme/tokens';
import * as C from './client';
type Field = { key: string; label: string; choices?: string[]; max?: number; multiline?: boolean };
type Form = {
  title: string;
  fields: Field[];
  values: Record<string, string>;
  submit: (values: Record<string, string>) => Promise<void>;
};
const done = z.object({}).passthrough();
const langs = [
  'English',
  'Hindi',
  'Marathi',
  'Bengali',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Gujarati',
  'Punjabi',
  'Other',
];
const nameField = { key: 'displayName', label: 'Name', max: 80 };
const languageField = { key: 'preferredLanguage', label: 'Preferred language', choices: langs };
const labels: Record<string, string> = {
  RECIPIENT_DETAILS: 'Recipient details',
  EMERGENCY_CONTACTS: 'Emergency contacts',
  ASSISTANCE_NOTES: 'Assistance preferences',
};
function Button({
  children,
  onPress,
  disabled = false,
}: {
  children: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, disabled && s.disabled]}
    >
      <Text style={s.buttonText}>{children}</Text>
    </Pressable>
  );
}
function Choices({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <View style={s.row}>
        {values.map((v) => (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityLabel={`${label}: ${v}`}
            accessibilityState={{ checked: value === v }}
            onPress={() => onChange(v)}
            style={[s.choice, value === v && s.selected]}
          >
            <Text style={s.copy}>{v.replaceAll('_', ' ')}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
function Check({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={s.choice}
    >
      <Text style={s.copy}>
        {value ? '[x]' : '[ ]'} {label}
      </Text>
    </Pressable>
  );
}
export function FamilyHome({
  auth,
  onSessionExpired,
}: {
  auth: AuthClient;
  onSessionExpired: () => void;
}) {
  const api = useMemo(() => new C.FamilyClient(auth), [auth]);
  const [tab, setTab] = useState('Family members'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [form, setForm] = useState<Form | null>(null);
  const [profile, setProfile] = useState<z.infer<typeof C.profileSchema> | null>(null),
    [recipients, setRecipients] = useState<C.Recipient[]>([]),
    [addresses, setAddresses] = useState<C.Address[]>([]),
    [activity, setActivity] = useState<z.infer<typeof C.activitySchema>[]>([]);
  const [selected, setSelected] = useState<C.Recipient | null>(null),
    [section, setSection] = useState('Details'),
    [consent, setConsent] = useState<z.infer<typeof C.consentSchema> | null>(null),
    [contacts, setContacts] = useState<C.Contact[]>([]),
    [members, setMembers] = useState<z.infer<typeof C.memberSchema>[]>([]),
    [invites, setInvites] = useState<z.infer<typeof C.invitationSchema>[]>([]);
  const [cursor, setCursor] = useState<string | null>(null),
    [inviteCursor, setInviteCursor] = useState<string | null>(null),
    [notice, setNotice] = useState(''),
    [code, setCode] = useState(''),
    [newCode, setNewCode] = useState(''),
    [requestedScopes, setRequestedScopes] = useState<string[]>(['RECIPIENT_DETAILS']),
    [contactPermission, setContactPermission] = useState(false),
    [adultConfirmed, setAdultConfirmed] = useState(false),
    [independent, setIndependent] = useState(true);
  const alive = useRef(true),
    loadSequence = useRef(0);
  const selections = useRef({ adultConfirmed, independent, contactPermission, requestedScopes });
  selections.current = { adultConfirmed, independent, contactPermission, requestedScopes };
  const clearPrivate = useCallback(() => {
    setSelected(null);
    setContacts([]);
    setMembers([]);
    setInvites([]);
    setConsent(null);
    setForm(null);
    setNewCode('');
    setCode('');
    setRecipients([]);
    setAddresses([]);
    setProfile(null);
    setActivity([]);
  }, []);
  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      setMessage('');
      try {
        await action();
      } catch (error) {
        if (!alive.current) return;
        setMessage(error instanceof Error ? error.message : 'Unable to connect.');
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          clearPrivate();
          onSessionExpired();
        }
        if (error instanceof C.FamilyError && [403, 404, 422].includes(error.status)) {
          setContacts([]);
          setMembers([]);
          setInvites([]);
          setNewCode('');
          if (error.status === 404) {
            setSelected(null);
            setForm(null);
          }
        }
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [clearPrivate, onSessionExpired],
  );
  const load = useCallback(
    async (more = false) => {
      const sequence = ++loadSequence.current;
      const query = more && cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      if (selected) {
        const record = await api.call(`/recipients/${selected.id}`, C.recipientSchema);
        if (!alive.current || sequence !== loadSequence.current) return;
        setSelected(record);
        if (section === 'Consent') {
          const [value, policy] = await Promise.all([
            api.call(`/recipients/${record.id}/consent`, C.consentSchema),
            api.call('/consent-policy', C.policySchema),
          ]);
          if (alive.current && sequence === loadSequence.current) {
            setConsent(value);
            setNotice(policy.notice);
          }
        }
        if (section === 'Emergency contacts') {
          const result = await api.call(
            `/recipients/${record.id}/emergency-contacts${query}`,
            C.pageSchema(C.contactSchema),
          );
          if (alive.current && sequence === loadSequence.current) {
            setContacts((v) => (more ? [...v, ...result.items] : result.items));
            setCursor(result.nextCursor);
          }
        }
        if (section === 'Care Circle') {
          const result = await api.call(
            `/recipients/${record.id}/care-circle${query}`,
            C.pageSchema(C.memberSchema),
          );
          const pending =
            record.role === 'STEWARD'
              ? await api.call(
                  `/recipients/${record.id}/care-circle/invitations`,
                  C.pageSchema(C.invitationSchema),
                )
              : null;
          if (alive.current && sequence === loadSequence.current) {
            setMembers((v) => (more ? [...v, ...result.items] : result.items));
            setInvites(pending?.items ?? []);
            setInviteCursor(pending?.nextCursor ?? null);
            setCursor(result.nextCursor);
          }
        }
      } else if (tab === 'Profile') {
        const value = await api.call('/profile', C.profileSchema);
        if (alive.current && sequence === loadSequence.current) setProfile(value);
      } else if (tab === 'Addresses') {
        const result = await api.call(`/addresses${query}`, C.pageSchema(C.addressSchema));
        if (alive.current && sequence === loadSequence.current) {
          setAddresses((v) => (more ? [...v, ...result.items] : result.items));
          setCursor(result.nextCursor);
        }
      } else if (tab === 'Privacy activity') {
        const result = await api.call(`/privacy/activity${query}`, C.pageSchema(C.activitySchema));
        if (alive.current && sequence === loadSequence.current) {
          setActivity((v) => (more ? [...v, ...result.items] : result.items));
          setCursor(result.nextCursor);
        }
      } else if (tab === 'Family members') {
        const result = await api.call(`/recipients${query}`, C.pageSchema(C.recipientSchema));
        if (alive.current && sequence === loadSequence.current) {
          setRecipients((v) => (more ? [...v, ...result.items] : result.items));
          setCursor(result.nextCursor);
        }
      }
    },
    [api, cursor, selected?.id, section, tab],
  );
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      loadSequence.current++;
    };
  }, []);
  useEffect(() => {
    setCursor(null);
    setContacts([]);
    setMembers([]);
    setInvites([]);
    setNewCode('');
    void run(() => loadRef.current());
  }, [tab, selected?.id, section, run]);
  function navigate(name: string) {
    setForm(null);
    if (name === tab) void run(() => loadRef.current());
    else {
      setBusy(true);
      setTab(name);
    }
  }
  useEffect(() => {
    const check = () => {
      if (AppState.currentState !== 'active') return;
      void run(() => loadRef.current());
    };
    const timer = setInterval(check, 30000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
      else {
        loadSequence.current++;
        clearPrivate();
      }
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [clearPrivate, form, run]);
  function editProfile() {
    if (!profile) return;
    setForm({
      title: 'Edit profile',
      fields: [nameField, languageField],
      values: { displayName: profile.displayName, preferredLanguage: profile.preferredLanguage },
      submit: async (v) => {
        setProfile(
          await api.call('/profile', C.profileSchema, 'PATCH', { ...v, version: profile.version }),
        );
      },
    });
  }
  function editAddress(address?: C.Address) {
    setForm({
      title: address ? 'Edit address' : 'Add address',
      fields: [
        { key: 'label', label: 'Address label', max: 80 },
        { key: 'line1', label: 'Address line 1', max: 160 },
        { key: 'line2', label: 'Address line 2 (optional)', max: 160 },
        { key: 'locality', label: 'Locality', max: 80 },
        { key: 'city', label: 'City', max: 80 },
        { key: 'state', label: 'State', max: 80 },
        { key: 'postalCode', label: 'Postal code', max: 6 },
        { key: 'longitude', label: 'Longitude (optional)' },
        { key: 'latitude', label: 'Latitude (optional)' },
      ],
      values: address
        ? {
            label: address.label,
            line1: address.line1,
            line2: address.line2,
            locality: address.locality,
            city: address.city,
            state: address.state,
            postalCode: address.postalCode,
            longitude: address.point?.coordinates[0].toString() ?? '',
            latitude: address.point?.coordinates[1].toString() ?? '',
          }
        : { label: 'Home' },
      submit: async (v) => {
        const { longitude = '', latitude = '', ...fields } = v;
        if (!!longitude !== !!latitude)
          throw new Error('Enter both longitude and latitude, or leave both empty.');
        await api.call(
          address ? `/addresses/${address.id}` : '/addresses',
          C.addressSchema,
          address ? 'PATCH' : 'POST',
          {
            line2: '',
            ...fields,
            country: 'IN',
            point: longitude
              ? { type: 'Point', coordinates: [Number(longitude), Number(latitude)] }
              : null,
            ...(address ? { version: address.version } : {}),
          },
        );
      },
    });
  }
  function editRecipient(recipient?: C.Recipient) {
    setAdultConfirmed(!!recipient);
    setForm({
      title: recipient ? 'Edit family member' : 'Add family member',
      fields: [
        nameField,
        {
          key: 'relationship',
          label: 'Relationship',
          choices: ['SELF', 'PARENT', 'SPOUSE', 'RELATIVE', 'OTHER'],
        },
        languageField,
        { key: 'communicationNeeds', label: 'Communication needs (optional)', max: 240 },
        ...(!recipient || recipient.assistanceNotes !== undefined
          ? [
              {
                key: 'assistanceNotes',
                label: 'Short assistance preferences (optional, no medical details)',
                max: 500,
                multiline: true,
              },
            ]
          : []),
      ],
      values: recipient
        ? {
            displayName: recipient.displayName,
            relationship: recipient.relationship,
            preferredLanguage: recipient.preferredLanguage,
            communicationNeeds: recipient.communicationNeeds,
            ...(recipient.assistanceNotes !== undefined
              ? { assistanceNotes: recipient.assistanceNotes }
              : {}),
          }
        : { relationship: 'PARENT', preferredLanguage: 'English', communicationNeeds: '' },
      submit: async (v) => {
        if (!selections.current.adultConfirmed && !recipient)
          throw new Error('Confirm that the recipient is an adult.');
        await api.call(
          recipient ? `/recipients/${recipient.id}` : '/recipients',
          C.recipientSchema,
          recipient ? 'PATCH' : 'POST',
          {
            ...v,
            adult: true,
            ...(recipient ? { version: recipient.version } : { state: 'PENDING_CONSENT' }),
          },
        );
      },
    });
  }
  function editContact(contact?: C.Contact) {
    if (!selected) return;
    setForm({
      title: contact ? 'Edit emergency contact' : 'Add emergency contact',
      fields: [
        nameField,
        { key: 'relationship', label: 'Relationship', max: 80 },
        {
          key: 'phone',
          label: contact ? 'New phone number (leave blank to keep)' : 'Contact phone number',
          max: 40,
        },
      ],
      values: contact
        ? { displayName: contact.displayName, relationship: contact.relationship }
        : {},
      submit: async (v) => {
        const body: Record<string, unknown> = {
          ...v,
          ...(contact ? { version: contact.version } : {}),
        };
        if (contact && !v.phone) delete body.phone;
        await api.call(
          `/recipients/${selected.id}/emergency-contacts${contact ? '/' + contact.id : ''}`,
          C.contactSchema,
          contact ? 'PATCH' : 'POST',
          body,
        );
      },
    });
  }
  function requestConsent() {
    if (!selected) return;
    setContactPermission(false);
    setIndependent(true);
    setRequestedScopes(['RECIPIENT_DETAILS']);
    setForm({
      title: 'Request assisted consent',
      fields: [
        { key: 'contactPhone', label: 'Recipient contact phone', max: 40 },
        { key: 'contactWindow', label: 'Suitable contact window', max: 160 },
        languageField,
        { key: 'communicationNeeds', label: 'Accessible communication needs', max: 240 },
      ],
      values: {
        preferredLanguage: selected.preferredLanguage,
        communicationNeeds: selected.communicationNeeds,
      },
      submit: async (v) => {
        if (!selections.current.contactPermission)
          throw new Error('Permission to use the contact details is required.');
        const policy = await api.call('/consent-policy', C.policySchema);
        await api.call(`/recipients/${selected.id}/assisted-consent-requests`, done, 'POST', {
          ...v,
          version: selected.version,
          contactPermission: true,
          independentConsentPossible: selections.current.independent,
          requestedScopes: selections.current.requestedScopes,
          noticeVersion: policy.noticeVersion,
        });
      },
    });
  }
  function invite() {
    if (!selected) return;
    setRequestedScopes(['RECIPIENT_DETAILS']);
    setForm({
      title: 'Invite to Care Circle',
      fields: [
        { key: 'phone', label: 'Intended customer phone', max: 40 },
        { key: 'role', label: 'Care Circle role', choices: ['VIEWER', 'EDITOR'] },
      ],
      values: { role: 'VIEWER' },
      submit: async (v) => {
        const result = await api.call(
          `/recipients/${selected.id}/care-circle/invitations`,
          z.object({ token: z.string() }),
          'POST',
          { ...v, version: selected.version, scopes: selections.current.requestedScopes },
        );
        setNewCode(result.token);
      },
    });
  }
  const canEdit = selected?.role === 'STEWARD' || selected?.role === 'EDITOR';
  const scopeForm =
    form?.title === 'Request assisted consent' || form?.title === 'Invite to Care Circle';
  return (
    <ScrollView
      style={s.safe}
      contentContainerStyle={s.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text accessibilityRole="header" style={s.title}>
        {selected ? selected.displayName : tab}
      </Text>
      <View style={s.row}>
        {selected ? (
          <Button
            onPress={() => {
              setSelected(null);
              setSection('Details');
            }}
          >
            Back to family members
          </Button>
        ) : (
          ['Family members', 'Profile', 'Addresses', 'Accept invitation', 'Privacy activity'].map(
            (name) => (
              <Button key={name} onPress={() => navigate(name)} disabled={busy}>
                {name}
              </Button>
            ),
          )
        )}
      </View>
      {busy ? (
        <ActivityIndicator
          accessibilityLabel="Loading family records"
          color={tokens.colors.primary}
        />
      ) : null}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={s.message}>
          {message}
        </Text>
      ) : null}
      <Button onPress={() => void run(() => loadRef.current())} disabled={busy}>
        Refresh records
      </Button>
      {form ? (
        <View style={s.card}>
          <Text accessibilityRole="header" style={s.heading}>
            {form.title}
          </Text>
          {form.fields.map((field) =>
            field.choices ? (
              <Choices
                key={field.key}
                label={field.label}
                values={field.choices}
                value={form.values[field.key] ?? ''}
                onChange={(value) =>
                  setForm({ ...form, values: { ...form.values, [field.key]: value } })
                }
              />
            ) : (
              <View key={field.key}>
                <Text style={s.label}>{field.label}</Text>
                <TextInput
                  accessibilityLabel={field.label}
                  style={s.input}
                  value={form.values[field.key] ?? ''}
                  maxLength={field.max ?? 160}
                  multiline={field.multiline}
                  onChangeText={(value) =>
                    setForm({ ...form, values: { ...form.values, [field.key]: value } })
                  }
                  editable={!busy}
                />
              </View>
            ),
          )}
          {form.title === 'Add family member' ? (
            <>
              <Check
                label="This recipient is an adult"
                value={adultConfirmed}
                onChange={setAdultConfirmed}
              />
              <Text style={s.copy}>
                You will steward this record. This does not make you a legal guardian or establish
                the recipient's consent.
              </Text>
            </>
          ) : null}
          {scopeForm ? (
            <>
              <Text style={s.label}>Requested visibility</Text>
              {C.scopes
                .filter(
                  (scope) =>
                    form.title !== 'Invite to Care Circle' ||
                    selected?.consentScopes.includes(scope),
                )
                .map((scope) => (
                  <Check
                    key={scope}
                    label={labels[scope] ?? scope}
                    value={requestedScopes.includes(scope)}
                    onChange={(checked) =>
                      setRequestedScopes((v) =>
                        checked ? [...v, scope] : v.filter((s) => s !== scope),
                      )
                    }
                  />
                ))}
            </>
          ) : null}
          {form.title === 'Request assisted consent' ? (
            <>
              <Text style={s.copy}>
                Staff will explain the service, categories, purposes, proposed family visibility,
                optionality and withdrawal in the recipient's preferred language. A second
                authorized person reviews the evidence. No smartphone or customer account is needed
                for the recipient.
              </Text>
              <Text style={s.copy}>
                {notice ||
                  profile?.policy.notice ||
                  'This development privacy notice covers optional non-medical assistance and family sharing only. It requires review before a pilot.'}
              </Text>
              <Check
                label="I have permission to submit these contact details"
                value={contactPermission}
                onChange={setContactPermission}
              />
              <Check
                label="The adult can independently communicate a consent decision"
                value={independent}
                onChange={setIndependent}
              />
              {!independent ? (
                <Text style={s.message}>
                  Lawful-authority review is required. Sharing will remain blocked.
                </Text>
              ) : null}
            </>
          ) : null}
          <Button
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await form.submit(form.values);
                setForm(null);
                await loadRef.current();
              })
            }
          >
            Save
          </Button>
          <Button disabled={busy} onPress={() => setForm(null)}>
            Cancel
          </Button>
        </View>
      ) : null}
      {!selected && tab === 'Profile' && profile ? (
        <View style={s.card}>
          <Text style={s.heading}>{profile.displayName || 'Complete your profile'}</Text>
          <Text style={s.copy}>{profile.maskedPhone} - verified, read only</Text>
          <Text style={s.copy}>{profile.preferredLanguage}</Text>
          <Button onPress={editProfile} disabled={busy}>
            Edit profile
          </Button>
          <Text style={s.copy}>{profile.policy.notice}</Text>
          <Text style={s.copy}>Notice version: {profile.policy.noticeVersion}</Text>
        </View>
      ) : null}
      {!selected && tab === 'Addresses' ? (
        <>
          <Button onPress={() => editAddress()} disabled={busy}>
            Add address
          </Button>
          {!addresses.length && !busy ? <Text style={s.copy}>No addresses yet.</Text> : null}
          {addresses.map((address) => (
            <View key={address.id} style={s.card}>
              <Text style={s.heading}>{address.label}</Text>
              <Text style={s.copy}>
                {address.line1} {address.line2}, {address.locality}, {address.city}, {address.state}{' '}
                {address.postalCode}
              </Text>
              <Button onPress={() => editAddress(address)} disabled={busy}>
                Edit address
              </Button>
              <Button
                onPress={() =>
                  void run(async () => {
                    await api.call(`/addresses/${address.id}`, done, 'DELETE', {
                      version: address.version,
                    });
                    await loadRef.current();
                  })
                }
                disabled={busy}
              >
                Archive address
              </Button>
            </View>
          ))}
        </>
      ) : null}
      {!selected && tab === 'Family members' ? (
        <>
          <Text style={s.copy}>
            Keep everyday assistance organized. Sharing begins after independent consent review.
          </Text>
          <Button onPress={() => editRecipient()} disabled={busy}>
            Add family member
          </Button>
          {!recipients.length && !busy ? (
            <Text style={s.copy}>No family members yet. Add an adult recipient to begin.</Text>
          ) : null}
          {recipients.map((recipient) => (
            <View key={recipient.id} style={s.card}>
              <Text style={s.heading}>{recipient.displayName}</Text>
              <Text style={s.copy}>
                {recipient.state.replaceAll('_', ' ')} - {recipient.role}
              </Text>
              <Text style={s.copy}>
                {recipient.sharingFrozen ? 'Sharing blocked' : 'Consent scopes apply until expiry'}
              </Text>
              <Button
                disabled={busy}
                onPress={() => {
                  setSection('Details');
                  setSelected(recipient);
                }}
              >
                View family member
              </Button>
            </View>
          ))}
        </>
      ) : null}
      {!selected && tab === 'Accept invitation' ? (
        <View style={s.card}>
          <Text style={s.copy}>
            Only the intended signed-in customer can accept. Acceptance never expands the adult's
            approved consent.
          </Text>
          <Text style={s.label}>Invitation code</Text>
          <TextInput
            accessibilityLabel="Invitation code"
            value={code}
            onChangeText={setCode}
            maxLength={43}
            autoCapitalize="none"
            style={s.input}
          />
          <Button
            disabled={busy || !code}
            onPress={() =>
              void run(async () => {
                await api.call(
                  `/care-circle/invitations/${encodeURIComponent(code)}/accept`,
                  done,
                  'POST',
                  {},
                );
                setCode('');
                setTab('Family members');
              })
            }
          >
            Accept invitation
          </Button>
        </View>
      ) : null}
      {!selected && tab === 'Privacy activity' ? (
        <>
          {!activity.length && !busy ? <Text style={s.copy}>No activity yet.</Text> : null}
          {activity.map((event) => (
            <View key={event.id} style={s.card}>
              <Text style={s.copy}>{event.action.replaceAll('_', ' ')}</Text>
              <Text style={s.copy}>{new Date(event.createdAt).toLocaleString()}</Text>
            </View>
          ))}
        </>
      ) : null}
      {selected ? (
        <>
          <View style={s.row}>
            {['Details', 'Consent', 'Emergency contacts', 'Care Circle'].map((v) => (
              <Button key={v} onPress={() => setSection(v)} disabled={busy}>
                {v}
              </Button>
            ))}
          </View>
          <Text style={s.copy}>
            {selected.state.replaceAll('_', ' ')} -{' '}
            {selected.sharingFrozen ? 'Sharing blocked' : 'Approved scopes apply'}
          </Text>
        </>
      ) : null}
      {selected && section === 'Details' ? (
        <View style={s.card}>
          <Text style={s.copy}>
            {selected.relationship} - {selected.preferredLanguage}
          </Text>
          <Text style={s.copy}>{selected.communicationNeeds}</Text>
          {selected.assistanceNotes !== undefined ? (
            <Text style={s.copy}>
              Assistance preferences: {selected.assistanceNotes || 'None recorded'}
            </Text>
          ) : null}
          {canEdit ? (
            <Button onPress={() => editRecipient(selected)} disabled={busy}>
              Edit family member
            </Button>
          ) : null}
          {selected.role === 'STEWARD' ? (
            <Button
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  await api.call(`/recipients/${selected.id}`, done, 'DELETE', {
                    version: selected.version,
                  });
                  setSelected(null);
                  setTab('Family members');
                })
              }
            >
              Archive family member
            </Button>
          ) : null}
        </View>
      ) : null}
      {selected && section === 'Consent' ? (
        <View style={s.card}>
          <Text accessibilityRole="header" style={s.heading}>
            Consent status
          </Text>
          <Text style={s.copy}>
            {consent?.case?.state.replaceAll('_', ' ') ?? 'No review requested'}
          </Text>
          <Text style={s.copy}>{consent?.case?.reasonCode?.replaceAll('_', ' ')}</Text>
          <Text style={s.copy}>{consent?.nextStep}</Text>
          <Text style={s.copy}>
            Scopes: {consent?.scopes.map((v) => labels[v]).join(', ') || 'None'}
          </Text>
          <Text style={s.copy}>
            Notice: {consent?.noticeVersion}.{' '}
            {consent?.expiresAt
              ? `Consent expires ${new Date(consent.expiresAt).toLocaleString()}`
              : ''}
          </Text>
          {selected.role === 'STEWARD' ? (
            <>
              <Button disabled={busy} onPress={requestConsent}>
                Request assisted consent
              </Button>
              {consent?.case ? (
                <Button
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await api.call(
                        `/recipients/${selected.id}/consent-withdrawal-requests`,
                        done,
                        'POST',
                        { version: selected.version, reasonCode: 'RECIPIENT_REQUESTED_CONTACT' },
                      );
                      await loadRef.current();
                    })
                  }
                >
                  Request withdrawal and stop sharing
                </Button>
              ) : null}
              <Text style={s.copy}>
                For corrections or a declined/unverified case, request a new independent review. A
                withdrawal request stops sharing immediately; staff will verify the recipient's
                decision.
              </Text>
            </>
          ) : null}
        </View>
      ) : null}
      {selected && section === 'Emergency contacts' ? (
        <>
          {canEdit ? (
            <Button disabled={busy} onPress={() => editContact()}>
              Add emergency contact
            </Button>
          ) : null}
          <Text style={s.copy}>
            Contacts are records. They receive no account, notification or access automatically.
          </Text>
          {!contacts.length && !busy ? (
            <Text style={s.copy}>No emergency contacts available.</Text>
          ) : null}
          {contacts.map((contact) => (
            <View key={contact.id} style={s.card}>
              <Text style={s.heading}>{contact.displayName}</Text>
              <Text style={s.copy}>
                {contact.relationship} - {contact.maskedPhone}
              </Text>
              {canEdit ? (
                <>
                  <Button disabled={busy} onPress={() => editContact(contact)}>
                    Edit emergency contact
                  </Button>
                  <Button
                    disabled={busy}
                    onPress={() =>
                      void run(async () => {
                        await api.call(
                          `/recipients/${selected.id}/emergency-contacts/${contact.id}`,
                          done,
                          'DELETE',
                          { version: contact.version },
                        );
                        await loadRef.current();
                      })
                    }
                  >
                    Archive emergency contact
                  </Button>
                </>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
      {selected && section === 'Care Circle' ? (
        <>
          {selected.role === 'STEWARD' ? (
            <Button
              disabled={
                busy ||
                selected.state !== 'ACTIVE' ||
                selected.sharingFrozen ||
                !selected.consentExpiresAt ||
                Date.parse(selected.consentExpiresAt) <= Date.now()
              }
              onPress={invite}
            >
              Invite customer
            </Button>
          ) : null}
          {newCode ? (
            <View style={s.card}>
              <Text style={s.copy}>
                Share this code privately. It works once, for the intended verified customer, and
                expires in seven days.
              </Text>
              <Text selectable style={s.copy}>
                {newCode}
              </Text>
              <Button onPress={() => setNewCode('')}>Hide invitation code</Button>
            </View>
          ) : null}
          {members.map((member) => (
            <View key={member.id} style={s.card}>
              <Text style={s.copy}>
                {member.identityLabel} - {member.role} - {member.status}
              </Text>
              <Text style={s.copy}>{member.scopes.map((v) => labels[v]).join(', ')}</Text>
              {selected.role === 'STEWARD' &&
              member.role !== 'STEWARD' &&
              member.status === 'ACTIVE' ? (
                <Button
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await api.call(
                        `/recipients/${selected.id}/care-circle/members/${member.id}`,
                        done,
                        'DELETE',
                        { version: member.version },
                      );
                      await loadRef.current();
                    })
                  }
                >
                  Revoke member
                </Button>
              ) : null}
            </View>
          ))}
          {invites.map((invitation) => (
            <View key={invitation.id} style={s.card}>
              <Text style={s.copy}>
                {invitation.maskedPhone} - {invitation.role} - {invitation.status}
              </Text>
              <Text style={s.copy}>Expires {new Date(invitation.expiresAt).toLocaleString()}</Text>
              {invitation.status === 'PENDING' ? (
                <Button
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await api.call(
                        `/recipients/${selected.id}/care-circle/invitations/${invitation.id}`,
                        done,
                        'DELETE',
                        { version: invitation.version },
                      );
                      await loadRef.current();
                    })
                  }
                >
                  Revoke invitation
                </Button>
              ) : null}
            </View>
          ))}
          {inviteCursor ? (
            <Button
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  const page = await api.call(
                    `/recipients/${selected.id}/care-circle/invitations?cursor=${encodeURIComponent(inviteCursor)}`,
                    C.pageSchema(C.invitationSchema),
                  );
                  if (alive.current) {
                    setInvites((v) => [...v, ...page.items]);
                    setInviteCursor(page.nextCursor);
                  }
                })
              }
            >
              Load more invitations
            </Button>
          ) : null}
        </>
      ) : null}
      {cursor ? (
        <Button disabled={busy} onPress={() => void run(() => loadRef.current(true))}>
          Load more
        </Button>
      ) : null}
    </ScrollView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: tokens.colors.background },
  container: {
    padding: 24,
    paddingBottom: 60,
    maxWidth: 740,
    width: '100%',
    alignSelf: 'center',
    gap: 12,
  },
  title: { fontSize: 28, fontWeight: '600', color: tokens.colors.ink },
  heading: { fontSize: 20, fontWeight: '600', color: tokens.colors.ink },
  copy: { fontSize: 14, lineHeight: 23, color: tokens.colors.ink },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: tokens.colors.ink,
    marginTop: 16,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    backgroundColor: tokens.colors.surface,
    gap: 12,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: tokens.colors.ink,
    backgroundColor: '#fff',
  },
  button: {
    minHeight: 44,
    padding: 12,
    borderRadius: 8,
    backgroundColor: tokens.colors.primary,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  choice: {
    minHeight: 44,
    padding: 12,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: 8,
    marginVertical: 4,
  },
  selected: { backgroundColor: tokens.colors.accent, borderColor: tokens.colors.primary },
  disabled: { opacity: 0.45 },
  message: {
    padding: 16,
    backgroundColor: tokens.colors.accent,
    color: tokens.colors.ink,
    fontSize: 14,
    lineHeight: 23,
  },
});
