/**
 * 验证 /api/v1/chat 在同源 localhost:8000 下可连通
 * HENGAI_BASE_URL 默认 http://localhost:8000
 */
const BASE = (process.env.HENGAI_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');

async function main() {
  const email = process.env.HENGAI_TEST_USER || `verify_${Date.now()}@example.com`;
  const password = process.env.HENGAI_TEST_PASS || 'VerifyChat123!';

  let token = '';
  const reg = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      email,
      password,
      company_name: 'ChatVerify Co',
    }),
  });
  if (reg.ok) {
    const rd = await reg.json();
    token = rd.access_token || rd.token || '';
  } else {
    const login = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!login.ok) {
      console.error('auth failed', reg.status, await reg.text(), login.status, await login.text());
      process.exit(1);
    }
    const ld = await login.json();
    token = ld.access_token || ld.token || '';
  }
  if (!token) {
    console.error('no token');
    process.exit(1);
  }

  const chatRes = await fetch(`${BASE}/api/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'ping' }],
      appState: { user: { name: email, tier: 'FREE_USER' }, flags: {}, company: {} },
      appStateSummary: 'test',
      stream: true,
    }),
  });

  if (!chatRes.ok) {
    console.error('chat HTTP', chatRes.status, await chatRes.text());
    process.exit(1);
  }
  const chunk = await chatRes.text();
  if (!chunk || chunk.length < 5) {
    console.error('chat empty body');
    process.exit(1);
  }
  console.log('OK chat', chatRes.status, 'bytes', chunk.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
