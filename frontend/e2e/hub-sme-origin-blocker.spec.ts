import { test, expect } from '@playwright/test';

/**
 * SME 在工业原厂 iframe 拦截页点击「前往 CBAM 测算 · 下游认领」
 * 应切换父页至 #page-calc，而非在 iframe 内打开全域中心（套娃 / 无反应）。
 */
test.describe('工业原厂 SME 拦截 → 返回 CBAM', () => {
  test('hi-sme-goto-calc 切换父页 page-calc', async ({ page }) => {
    await page.goto('/%E5%85%A8%E5%9F%9F%E4%B8%AD%E5%BF%83.html#calc', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => typeof (window as any).navTo === 'function');

    await page.evaluate(() => {
      const w = window as any;
      w.AppState = w.AppState || {};
      w.AppState.user = { isLoggedIn: true, name: 'ziteng' };
      w.AppState.flags = { hasOriginFactoryPerm: false, userRole: 'ROLE_SME' };
      w.navTo('origin-audit', document.getElementById('n-origin-audit'));
    });

    await expect(page.locator('#page-origin-audit')).toHaveClass(/active/);

    const frame = page.frameLocator('#page-origin-audit iframe.embed-frame');
    await frame.locator('#hi-suite').waitFor({ state: 'attached', timeout: 15_000 });

    await frame.locator('body').evaluate(() => {
      const w = window as any;
      w.AppState = w.AppState || {};
      w.AppState.user = { isLoggedIn: true, name: 'ziteng' };
      w.AppState.flags = { hasOriginFactoryPerm: false, userRole: 'ROLE_SME' };
      if (typeof w.guardOriginFactoryPage === 'function') w.guardOriginFactoryPage();
    });

    const gotoBtn = frame.locator('#hi-sme-goto-calc');
    await expect(gotoBtn).toBeVisible({ timeout: 10_000 });
    await gotoBtn.click();

    await expect(page.locator('#page-calc')).toHaveClass(/active/, { timeout: 5_000 });
    await expect(page.locator('#page-origin-audit')).not.toHaveClass(/active/);
    await expect(page.locator('#tb-title')).toContainText('CBAM');
  });

  test('switchHubPage(calc) 在 iframe 内调用父页 navTo', async ({ page }) => {
    await page.goto('/%E5%85%A8%E5%9F%9F%E4%B8%AD%E5%BF%83.html#origin-audit', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => typeof (window as any).navTo === 'function');

    const frame = page.frameLocator('#page-origin-audit iframe.embed-frame');
    await frame.locator('body').waitFor({ state: 'attached', timeout: 15_000 });

    const switched = await frame.locator('body').evaluate(async () => {
      const w = window as any;
      if (typeof w.gotoCbamFromOriginBlocker !== 'function') return 'no-fn';
      w.gotoCbamFromOriginBlocker();
      try {
        const parent = window.parent;
        const calcPanel = parent.document.getElementById('page-calc');
        return calcPanel && calcPanel.classList.contains('active') ? 'ok' : 'not-active';
      } catch {
        return 'parent-error';
      }
    });

    expect(switched).toBe('ok');
  });
});
