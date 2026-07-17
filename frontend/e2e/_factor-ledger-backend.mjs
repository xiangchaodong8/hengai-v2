/**
 * 双角色后端权威台账 E2E（#1 + #2 + #4 + #7）
 * SME 申报绑定 → 未确认引用被 403 → 原厂确认 → SME 实名/匿名引用 → 原厂台账可见
 */
const BASE = 'http://127.0.0.1:8000/api/v1';
const ORIGIN_EMAIL = 'ziteng@co2lion.com';
const ORIGIN_PWD = 'xd23587052';
const SME_EMAIL = 'sme.binding.test@co2lion.com';
const SME_PWD = 'xdtest1234';
const SME_COMPANY = '东莞新能模具';
const RUN = Date.now().toString(36);

const results = [];
const pass = (n, d) => results.push({ n, ok: true, d });
const fail = (n, d) => results.push({ n, ok: false, d });

async function api(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

async function login(email, password) {
  const { status, data } = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (status !== 200 || !data.access_token) throw new Error(`login ${email} → HTTP ${status}`);
  return data.access_token;
}

async function main() {
  /* 1. 原厂登录 */
  const originToken = await login(ORIGIN_EMAIL, ORIGIN_PWD);
  pass('原厂登录', ORIGIN_EMAIL);

  /* 2. SME 注册或登录 + 完善档案（非原厂行业） */
  let smeToken;
  const reg = await api('/auth/register', {
    method: 'POST',
    body: { email: SME_EMAIL, password: SME_PWD, company_name: SME_COMPANY },
  });
  if (reg.status === 201 && reg.data.access_token) smeToken = reg.data.access_token;
  else smeToken = await login(SME_EMAIL, SME_PWD);
  pass('SME 账号就绪', SME_EMAIL);
  await api('/hub/workspace-update', {
    method: 'POST', token: smeToken,
    body: { name: SME_COMPANY, industryCode: 'machinery', mainProduct: '钢制紧固件', annualExportTons: 500, exportCountries: '德国', regionTag: 'gd' },
  });

  /* 3. 未绑定时引用 → 403（用每轮全新账号验证，不受历史绑定影响） */
  const fresh = await api('/auth/register', {
    method: 'POST',
    body: { email: `sme.noband.${RUN}@co2lion.com`, password: SME_PWD, company_name: `无绑定测试-${RUN}` },
  });
  if (fresh.status === 201 && fresh.data.access_token) {
    await api('/hub/workspace-update', {
      method: 'POST', token: fresh.data.access_token,
      body: { name: `无绑定测试-${RUN}`, industryCode: 'machinery' },
    });
    const blocked = await api('/hub/factor-consume', {
      method: 'POST', token: fresh.data.access_token,
      body: { batchId: `E2E-${RUN}-PRE`, qtyTons: 10, claimMode: 'claimed' },
    });
    if (blocked.status === 403) pass('无绑定引用被阻断', `403 · ${String(blocked.data.detail).slice(0, 24)}…`);
    else fail('无绑定引用被阻断', `HTTP ${blocked.status}`);
  } else fail('无绑定引用被阻断', `临时账号注册失败 HTTP ${fresh.status}`);

  /* 4. SME 申报绑定（自由文本 → 匹配原厂工作区） */
  const decl = await api('/hub/supply-binding/declare', {
    method: 'POST', token: smeToken,
    body: { originQuery: '武汉钢铁', materialType: '冶金焦' },
  });
  if (decl.status === 200 && decl.data.binding) {
    pass('绑定申报', `matched=${decl.data.matched} · status=${decl.data.binding.status} · origin=${decl.data.binding.originName || '未匹配'}`);
  } else fail('绑定申报', `HTTP ${decl.status} ${JSON.stringify(decl.data).slice(0, 120)}`);
  const bindingId = decl.data.binding && decl.data.binding.bindingId;

  /* 5. 原厂查看待确认列表（双向握手·原厂侧实名可见） */
  const pending = await api('/hub/supply-binding/pending', { token: originToken });
  const mine = (pending.data.pendingBindings || []).find((b) => b.bindingId === bindingId);
  const alreadyConfirmed = decl.data.binding && decl.data.binding.status === 'confirmed';
  if (mine && mine.downstreamName === SME_COMPANY) pass('原厂见实名申报', mine.downstreamName);
  else if (alreadyConfirmed) pass('原厂见实名申报', '此前已确认（幂等复跑）');
  else fail('原厂见实名申报', JSON.stringify(pending.data).slice(0, 150));

  /* 6. 原厂确认绑定 */
  if (!alreadyConfirmed) {
    const conf = await api('/hub/supply-binding/confirm', {
      method: 'POST', token: originToken,
      body: { bindingId, approve: true },
    });
    if (conf.status === 200 && conf.data.binding.status === 'confirmed') pass('原厂确认绑定', conf.data.message);
    else fail('原厂确认绑定', `HTTP ${conf.status} ${JSON.stringify(conf.data).slice(0, 120)}`);
  } else pass('原厂确认绑定', '已是 confirmed');

  /* 7. SME 实名引用 */
  const c1 = await api('/hub/factor-consume', {
    method: 'POST', token: smeToken,
    body: { batchId: `E2E-${RUN}-A`, qtyTons: 100, claimMode: 'claimed' },
  });
  if (c1.status === 200 && c1.data.success && c1.data.taxSavedEur > 0) {
    pass('实名引用记账', `factor=${c1.data.factor} · 挽回€${c1.data.taxSavedEur}`);
  } else fail('实名引用记账', `HTTP ${c1.status} ${JSON.stringify(c1.data).slice(0, 120)}`);

  /* 8. 同批次重复引用 → 幂等 */
  const dup = await api('/hub/factor-consume', {
    method: 'POST', token: smeToken,
    body: { batchId: `E2E-${RUN}-A`, qtyTons: 100, claimMode: 'claimed' },
  });
  if (dup.status === 200 && dup.data.duplicated) pass('批次幂等', 'duplicated=true');
  else fail('批次幂等', JSON.stringify(dup.data).slice(0, 100));

  /* 9. SME 匿名引用 */
  const c2 = await api('/hub/factor-consume', {
    method: 'POST', token: smeToken,
    body: { batchId: `E2E-${RUN}-B`, qtyTons: 50, claimMode: 'anonymous' },
  });
  if (c2.status === 200 && c2.data.claimMode === 'anonymous') pass('匿名引用记账', `碳吨位 ${c2.data.carbonTonnage}`);
  else fail('匿名引用记账', JSON.stringify(c2.data).slice(0, 100));

  /* 9b. 省略 claimMode 时默认匿名（场景B 默认值） */
  const c3 = await api('/hub/factor-consume', {
    method: 'POST', token: smeToken,
    body: { batchId: `E2E-${RUN}-C`, qtyTons: 30 },
  });
  if (c3.status === 200 && c3.data.claimMode === 'anonymous') pass('默认匿名策略', 'claimMode 缺省 -> anonymous');
  else fail('默认匿名策略', JSON.stringify(c3.data).slice(0, 100));

  /* 10. 原厂台账：聚合 + 实名/匿名分层 + k-匿名 */
  const ledger = await api('/hub/origin-factor-ledger', { token: originToken });
  const cl = ledger.data.consumptionLedger || {};
  if (ledger.status === 200 && cl.total && cl.total.count >= 2) pass('台账聚合', `count=${cl.total.count} · 挽回€${cl.total.taxSavedEur}`);
  else fail('台账聚合', `HTTP ${ledger.status} ${JSON.stringify(cl.total || {})}`);
  const claimedHit = (cl.claimedConsumers || []).some((c) => c.companyName === SME_COMPANY);
  if (claimedHit) pass('实名消费者可见', SME_COMPANY);
  else fail('实名消费者可见', JSON.stringify(cl.claimedConsumers || []).slice(0, 150));
  const anons = cl.anonymousConsumers || [];
  const vis = cl.visibilityScope || {};
  const optIns = cl.downstreamOptIns || [];
  const anonLeak = JSON.stringify(anons).includes(SME_COMPANY);
  const kMasked = anons.length > 0 && anons.every((a) => a.region === '已脱敏' || a.region);
  if (anons.length > 0 && !anonLeak) pass('匿名层不泄露企业名', `${anons.length} 条 · k-匿名 region=${anons[anons.length - 1].region}`);
  else fail('匿名层不泄露企业名', anonLeak ? '泄露!' : '无匿名记录');
  if (cl.serviceFeePct === 0.03 && cl.nursingFundPct === 0.01 && cl.serviceFeeEur != null) {
    pass('服务费/护航基金计提', `服务费€${cl.serviceFeeEur} · 基金€${cl.nursingFundEur}`);
  } else fail('服务费/护航基金计提', JSON.stringify({ fee: cl.serviceFeePct, fund: cl.nursingFundPct }));
  if (vis.consumptionLedgerDisclosure === 'opt_in_required' && vis.identityDisclosure === 'auto_on_commitment') {
    pass('可见性契约字段', 'visibilityScope 返回正确');
  } else fail('可见性契约字段', JSON.stringify(vis));
  if (Array.isArray(optIns) && optIns.some((o) => o.companyName === SME_COMPANY)) {
    pass('opt-in 名单回传', `downstreamOptIns=${optIns.length}`);
  } else fail('opt-in 名单回传', JSON.stringify(optIns).slice(0, 120));

  /* 11. SME 视角不可访问原厂台账 */
  const deny = await api('/hub/origin-factor-ledger', { token: smeToken });
  if (deny.status === 403) pass('台账原厂专属', 'SME 访问 → 403');
  else fail('台账原厂专属', `HTTP ${deny.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log('\n=== 后端权威台账 + 双向握手 E2E ===\n');
  results.forEach((r) => console.log((r.ok ? '✓' : '✗') + ' ' + r.n + (r.d ? ' — ' + r.d : '')));
  console.log('\n' + results.filter((r) => r.ok).length + '/' + results.length + ' 通过\n');
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('E2E 异常:', e.message); process.exit(1); });
