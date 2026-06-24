const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function getTurnstileConfig(): { enabled: boolean; siteKey: string } {
  const siteKey = String(process.env.TURNSTILE_SITE_KEY || '').trim();
  const secretKey = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
  return {
    enabled: !!(siteKey && secretKey),
    siteKey
  };
}

interface VerifyTurnstileTokenParams {
  token?: string;
  remoteIp?: string;
  expectedHostname?: string;
  expectedAction?: string;
  fetchImpl?: typeof fetch;
}

interface VerifyTurnstileTokenResult {
  success: boolean;
  skipped?: boolean;
  errorCodes?: string[];
  hostname?: string;
  action?: string;
  hostnameMatches?: boolean;
  actionMatches?: boolean;
  detail?: string;
}

export async function verifyTurnstileToken({
  token,
  remoteIp = '',
  expectedHostname = '',
  expectedAction = 'register',
  fetchImpl = fetch
}: VerifyTurnstileTokenParams = {}): Promise<VerifyTurnstileTokenResult> {
  const secret = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('WARNING: TURNSTILE_SECRET_KEY not set, bot protection disabled');
    }
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
    const result: any = await response.json();
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
  } catch (error: any) {
    return {
      success: false,
      errorCodes: ['siteverify-unavailable'],
      detail: error?.message || String(error)
    };
  }
}
