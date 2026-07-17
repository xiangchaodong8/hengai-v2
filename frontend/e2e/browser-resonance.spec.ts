import { test, expect } from '@playwright/test';

test.describe('HengAI 批次7 · 浏览器共振烟测', () => {
  test('index 加载财务内核与共振总线', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => typeof (window as any).computeRepFinancials === 'function');
    await page.waitForFunction(() => typeof (window as any).hengaiApplyChatStateUpdate === 'function');

    const exports = await page.evaluate(() => ({
      compute: typeof window.computeRepFinancials,
      applyChat: typeof window.hengaiApplyChatStateUpdate,
      pipeline: typeof window.buildHubPipelinePayload,
      identity: typeof window.formatHubUserIdentity,
    }));

    expect(exports.compute).toBe('function');
    expect(exports.applyChat).toBe('function');
    expect(exports.pipeline).toBe('function');
    expect(exports.identity).toBe('function');
  });

  test('模拟 actions_taken.updatedState 驱动 ROI 非占位', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => typeof (window as any).computeRepFinancials === 'function');

    const fin = await page.evaluate(() => {
      const mock = {
        user: { tier: 'Guardian', regDate: '2024-03-01T00:00:00Z', gmBalance: 50 },
        metrics: { riskExposureEur: 68000, roiMultiple: 2.4, tCO2eTotal: 1240 },
        company: { name: '烟测企业' },
        flags: { currentPhase: 'Phase2' },
      };
      (window as any).hengaiApplyChatStateUpdate(mock, { source: 'e2e-smoke' });
      return (window as any).computeRepFinancials((window as any).AppState);
    });

    expect(fin.riskNum).toBeGreaterThan(0);
    expect(fin.roiDisplay).not.toBe('待测算');
    expect(fin.roiDisplay).toMatch(/1\s*:\s*[\d.]+/);
  });

  test('formatHubUserIdentity 与管道 tier_code', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => typeof (window as any).formatHubUserIdentity === 'function');

    const ident = await page.evaluate(() => {
      const id = (window as any).formatHubUserIdentity({
        tier: 'Sovereign',
        regDate: '2025-06-01T12:00:00Z',
      });
      const pipe = (window as any).buildHubPipelinePayload({
        user: { name: 'E2E', tier: 'Sovereign', regDate: '2025-06-01T12:00:00Z' },
        metrics: {},
        company: {},
      });
      return { ident: id, tierCode: pipe.user.tier_code, regLabel: pipe.user.regLabel };
    });

    expect(ident.ident.regDate).toBe('2025-06-01');
    expect(ident.ident.regLabel).toContain('2025-06-01');
    expect(ident.tierCode).toBeTruthy();
    expect(ident.regLabel).toContain('注册于');
  });
});
