import {expect, test} from '@playwright/test';

test('Android-style Back and browser Back return from chat to chat list without exiting', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Android-style navigation is mobile-only');
  await page.goto('/?demo=1');

  const app = page.locator('.app');
  const chats = page.locator('.conversation');
  await expect(chats.first()).toBeVisible();

  await chats.first().click();
  await expect(app).toHaveClass(/mobile-chat/);
  expect(await page.evaluate(() => window.history.state?.openChetChatView)).toBe(true);

  // Android WebView fallback or a browser/gesture Back event.
  await page.goBack();
  await expect(app).not.toHaveClass(/mobile-chat/);
  await expect(chats.first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');

  // User can enter a different chat after going back, without restarting app.
  await chats.nth(1).click();
  await expect(app).toHaveClass(/mobile-chat/);
  const nativeHandled = await page.evaluate(() => {
    const back = (window as Window & {openChetNativeBack?: () => boolean}).openChetNativeBack;
    return back?.() ?? false;
  });
  expect(nativeHandled).toBe(true);
  await expect(app).not.toHaveClass(/mobile-chat/);

  // The onscreen arrow and Android Back share the same history behaviour.
  await chats.first().click();
  await expect(app).toHaveClass(/mobile-chat/);
  await page.getByRole('button', {name:'Back to chats'}).click();
  await expect(app).not.toHaveClass(/mobile-chat/);
  await expect(chats.nth(1)).toBeVisible();
});
