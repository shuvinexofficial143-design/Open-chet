import {expect, test} from '@playwright/test';

test('Android-style Back and browser Back return from chat to chat list without exiting', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Android-style navigation is mobile-only');
  await page.goto('/?demo=1');

  const app = page.locator('.app');
  const chats = page.locator('.conversation');
  await expect(chats.first()).toBeVisible();

  await expect(page.locator('.mobile-inbox-mini-brand')).toBeVisible();
  await expect(page.locator('.mobile-inbox-mini-brand')).toContainText('Open Chet');
  const miniHeight=(await page.locator('.mobile-inbox-mini-brand').boundingBox())?.height||0;
  expect(miniHeight).toBeLessThanOrEqual(36);

  await chats.first().click();
  await expect(app).toHaveClass(/mobile-chat/);
  // Regression: compact chat-list CSS previously forced display:flex even when a
  // conversation was selected, covering the opened chat in the Android app.
  await expect(page.locator('.chat-list')).toBeHidden();
  await expect(page.locator('.chat-panel')).toBeVisible();
  await expect(page.locator('.mobile-nav')).toBeHidden();
  await expect(page.getByRole('button',{name:'Back to chats'})).toBeVisible();
  const viewport=page.viewportSize()!;
  const panel=await page.locator('.chat-panel').boundingBox();
  expect(panel?.width).toBeGreaterThan(viewport.width*0.92);
  const center=await page.locator('.chat-header .contact-heading').boundingBox();
  expect(center).not.toBeNull();
  const target=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('button')?.className||'',{
    x:center!.x+center!.width/2,y:center!.y+center!.height/2
  });
  expect(target).toContain('contact-heading');
  await page.locator('.chat-header .contact-heading').click();
  await expect(page.getByRole('complementary',{name:'Contact Info'})).toBeVisible();
  await page.getByRole('button',{name:'Close contact info'}).click();
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

test('mobile Contacts tab opens customer details by tapping a contact',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='mobile','Mobile-only contact navigation');
  await page.goto('/?demo=1');
  const tabs=page.locator('.mobile-nav');
  await tabs.getByRole('button',{name:'Contacts'}).click();
  await expect(page.getByRole('heading',{name:'Contacts'})).toBeVisible();
  const item=page.locator('.contact-list-item').first();
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByRole('complementary',{name:'Contact Info'})).toBeVisible();
  await page.getByRole('button',{name:'Close contact info'}).click();
  await expect(page.getByRole('heading',{name:'Contacts'})).toBeVisible();
});
