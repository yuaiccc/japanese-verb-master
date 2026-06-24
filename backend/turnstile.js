const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function getTurnstileConfig() {
  const siteKey = String(process.env.TURNSTILE_SITE_KEY || '').trim();
  const secretKey = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
  return {
    enabled: !!(siteKey && secretKey),
    siteKey
  };
}

export async function verifyTurnstileToken({
  token,
  remoteIp = '',
  expectedHostname = '',
  expectedAction = 'register',
  fetchImpl = fetch
} = {}) {
  const secret = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) {
    return { success: true, skipped: true };
  }
  if (!token) {
    return { success: false, errorCodes: ['missing-input-response'] };
  }

  const body = new URLSearchParams({
    secret,
    response: String(token)
  });
  if (remoteIp) body.set('remoteip', remoteIp);

  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const result = await response.json();
    const hostnameMatches = !expectedHostname || result.hostname === expectedHostname;
    const actionMatches = !expectedAction || result.action === expectedAction;
    return {
      success: !!result.success && hostnameMatches && actionMatches,
      hostname: result.hostname || '',
      action: result.action || '',
      errorCodes: result['error-codes'] || [],
      hostnameMatches,
      actionMatches
    };
  } catch (error) {
    return {
      success: false,
      errorCodes: ['siteverify-unavailable'],
      detail: error?.message || String(error)
    };
  }
}
