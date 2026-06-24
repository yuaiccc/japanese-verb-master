import test from 'node:test';
import assert from 'node:assert/strict';
import { getTurnstileConfig, verifyTurnstileToken } from '../turnstile';

test('Turnstile 未配置时本地跳过验证', async () => {
  const previous = process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  try {
    assert.deepEqual(await verifyTurnstileToken({ token: '' }), { success: true, skipped: true });
  } finally {
    if (previous === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = previous;
  }
});

test('Turnstile 配置后缺少 token 会拒绝', async () => {
  const previous = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SECRET_KEY = 'test-secret';
  try {
    const result = await verifyTurnstileToken({ token: '' });
    assert.equal(result.success, false);
    assert.deepEqual(result.errorCodes, ['missing-input-response']);
  } finally {
    if (previous === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = previous;
  }
});

test('Turnstile 校验 hostname 和 action', async () => {
  const previous = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SECRET_KEY = 'test-secret';
  try {
    const result = await verifyTurnstileToken({
      token: 'valid-token',
      expectedHostname: 'japanese-verb-master.onrender.com',
      expectedAction: 'register',
      fetchImpl: (async () => ({
        json: async () => ({
          success: true,
          hostname: 'japanese-verb-master.onrender.com',
          action: 'register'
        })
      })) as any
    });
    assert.equal(result.success, true);
  } finally {
    if (previous === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = previous;
  }
});

test('配置接口只公开 site key', () => {
  const beforeSite = process.env.TURNSTILE_SITE_KEY;
  const beforeSecret = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SITE_KEY = 'public-site-key';
  process.env.TURNSTILE_SECRET_KEY = 'private-secret';
  try {
    assert.deepEqual(getTurnstileConfig(), { enabled: true, siteKey: 'public-site-key' });
  } finally {
    if (beforeSite === undefined) delete process.env.TURNSTILE_SITE_KEY;
    else process.env.TURNSTILE_SITE_KEY = beforeSite;
    if (beforeSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = beforeSecret;
  }
});
