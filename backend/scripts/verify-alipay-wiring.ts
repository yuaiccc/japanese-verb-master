// 验证"只差填密钥"：不依赖真支付宝账号，用现生成的 RSA 密钥模拟，
// 证明 ①没配密钥=mock ②配上格式正确的密钥=alipay provider 能构造起来。
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const out: string[] = [];
const ok = (m: string) => out.push('PASS ' + m);
const bad = (m: string) => out.push('FAIL ' + m);

const { createPaymentProvider } = await import('../payments/provider');

// 1) 无密钥 → mock
delete process.env.ALIPAY_APP_ID;
delete process.env.ALIPAY_PRIVATE_KEY;
const mock = await createPaymentProvider({ db: makeMemDb() });
mock.name === 'mock' ? ok('无密钥时为 mock provider') : bad('无密钥应为 mock，实为 ' + mock.name);

// 2) 配上格式正确的沙箱风格密钥 → alipay
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const stripPem = (pem: string) => pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
process.env.ALIPAY_APP_ID = '2021000000000000';
process.env.ALIPAY_PRIVATE_KEY = stripPem(privateKey);
process.env.ALIPAY_PUBLIC_KEY = stripPem(publicKey);
process.env.ALIPAY_ENDPOINT = 'https://openapi-sandbox.dl.alipaydev.com';
process.env.ALIPAY_KEY_TYPE = 'PKCS8';

const ali = await createPaymentProvider({ db: makeMemDb() });
ali.name === 'alipay'
  ? ok('填入格式正确密钥后切到 alipay provider')
  : bad('应切到 alipay，实为 ' + ali.name + '（看上面 warn 日志查原因）');
typeof ali.createOrder === 'function' ? ok('alipay.createOrder 可用') : bad('alipay.createOrder 缺失');
typeof ali.queryOrder === 'function' ? ok('alipay.queryOrder 可用') : bad('alipay.queryOrder 缺失');
(ali.simulateBuyerConfirm === undefined) ? ok('alipay 无 simulate（付款须真实完成）') : bad('alipay 不应有 simulate');

const failed = out.filter(l => l.startsWith('FAIL'));
console.log('\n' + out.join('\n'));
console.log('\n=== ' + (failed.length ? `${failed.length} FAILED` : 'ALL PASSED') + ' ===');
console.log('（说明：这里没调真实支付宝接口；真正下单需要真沙箱密钥 + 网络。结构链路已通。）');
process.exit(failed.length ? 1 : 0);

// 内存 sqlite，避免污染真实 dictionary.db
function makeMemDb(): any {
  return new Database(':memory:');
}
