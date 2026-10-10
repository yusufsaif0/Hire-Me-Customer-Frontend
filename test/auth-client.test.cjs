const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { AuthClient } = require('../.test-build/auth/client');
const user = {
  id: randomUUID(),
  role: 'CUSTOMER',
  maskedPhone: '+91*****1234',
  onboardingStatus: 'NOT_APPLICABLE',
};
const challenge = {
  challengeId: randomUUID(),
  challengeToken: 'test-challenge',
  resendAfterSeconds: 60,
  expiresInSeconds: 300,
  maskedPhone: user.maskedPhone,
};
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function storage(value = null) {
  return {
    value,
    async get() {
      return this.value;
    },
    async set(next) {
      this.value = next;
    },
    async clear() {
      this.value = null;
    },
  };
}
test('client rejects OTP leakage and sessions for the wrong role before storing credentials', async () => {
  const cache = storage();
  const leaked = new AuthClient('CUSTOMER', 'http://test', cache, async () =>
    json({ ...challenge, code: '123456' }),
  );
  await assert.rejects(() => leaked.begin('+919000012345'));
  const wrong = new AuthClient('CUSTOMER', 'http://test', cache, async () =>
    json({
      accessToken: 'fixture',
      refreshToken: 'fixture',
      expiresInSeconds: 900,
      user: { ...user, role: 'WORKER' },
    }),
  );
  await assert.rejects(() => wrong.verify(challenge, '123456'));
  assert.equal(cache.value, null);
});
test('concurrent expired-session recovery performs one refresh and updates the credential', async () => {
  const cache = storage('old-fixture');
  let count = 0;
  const client = new AuthClient('CUSTOMER', 'http://test', cache, async (url, options) => {
    if (url.endsWith('/refresh')) {
      count++;
      await new Promise((resolve) => setTimeout(resolve, 15));
      assert.equal(JSON.parse(options.body).refreshToken, 'old-fixture');
      return json({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresInSeconds: 900,
        user,
      });
    }
    assert.equal(options.headers.Authorization, 'Bearer new-access');
    return json(user);
  });
  const results = await Promise.all([client.me(), client.me()]);
  assert.equal(count, 1);
  assert.equal(results[0].id, user.id);
  assert.equal(cache.value, 'new-refresh');
});
test('family scope denial retains the signed-in session and authenticates domain requests', async () => {
  const cache = storage('fixture-refresh');
  const client = new AuthClient('CUSTOMER', 'http://test', cache, async (url, options) => {
    if (url.endsWith('/refresh'))
      return json({
        accessToken: 'fixture-access',
        refreshToken: 'rotated-refresh',
        expiresInSeconds: 900,
        user,
      });
    assert.equal(url, 'http://test/v1/customer/recipients');
    assert.equal(options.headers.Authorization, 'Bearer fixture-access');
    assert.equal(options.headers['Idempotency-Key'], 'fixture-key');
    return json({ code: 'FIELD_SCOPE_REQUIRED' }, 403);
  });
  const response = await client.familyRequest('/recipients', {
    headers: { 'Idempotency-Key': 'fixture-key' },
  });
  assert.equal(response.status, 403);
  assert.equal(cache.value, 'rotated-refresh');
  await assert.rejects(() => client.familyRequest('/admin/consent-cases'));
});
test('revoked refresh clears persisted credentials, while transient network errors retain them', async () => {
  const cache = storage('fixture');
  const denied = new AuthClient('CUSTOMER', 'http://test', cache, async () =>
    json(
      { statusCode: 401, code: 'INVALID_SESSION', message: 'Denied', requestId: randomUUID() },
      401,
    ),
  );
  await assert.rejects(() => denied.restore());
  assert.equal(cache.value, null);
  cache.value = 'fixture';
  const offline = new AuthClient('CUSTOMER', 'http://test', cache, async () => {
    throw new Error('Offline');
  });
  await assert.rejects(() => offline.restore());
  assert.equal(cache.value, 'fixture');
  await assert.rejects(() => offline.logout());
  assert.equal(cache.value, null);
});
