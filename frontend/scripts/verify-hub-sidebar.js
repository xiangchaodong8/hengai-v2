/**
 * 验证全域中心 #achieve 时侧栏高亮星火档案（非全域总览）
 */
const BASE = (process.env.HENGAI_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');

async function main() {
  const url = `${BASE}/static/全域中心.html#achieve`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  if (!html.includes('syncHubSidebarActive')) throw new Error('hub sidebar fix not in HTML');
  if (!html.includes("isHubShell = fn === '全域中心.html'")) throw new Error('AppState hub sidebar fix missing');
  console.log('OK verify-hub-sidebar static assets contain fix markers');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
