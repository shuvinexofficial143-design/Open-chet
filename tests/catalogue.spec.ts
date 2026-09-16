import {expect, test} from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.goto('/?demo=1');
});

const primaryNavigation = (page: import('@playwright/test').Page, projectName: string) =>
  projectName === 'mobile' ? page.locator('.mobile-nav') : page.locator('.mvp-sidebar nav');

test('MVP navigation stays focused and mobile chats start immediately with search', async ({page}, testInfo) => {
  const labels = await page.locator('.mobile-nav button span').allTextContents();
  expect(labels).toEqual(['Chats', 'Contacts', 'Tools', 'More']);
  await expect(page.locator('.mobile-nav select')).toHaveCount(0);
  await expect(page.locator('.mobile-nav')).not.toContainText('Campaigns');
  await expect(page.locator('.mobile-nav')).not.toContainText('Templates');
  await expect(page.getByLabel('Search chats')).toBeVisible();
  if (testInfo.project.name === 'mobile') {
    await expect(page.getByRole('heading', {name: 'Inbox'})).toHaveCount(0);
    await expect(page.locator('.filters')).toHaveCount(0);
    await expect(page.locator('.conversation').first()).toBeVisible();
  }

  const navigation = primaryNavigation(page, testInfo.project.name);
  await navigation.getByRole('button', {name: /Tools/}).click();
  await expect(page.getByRole('heading', {name: 'Tools'})).toBeVisible();
  await expect(page.locator('.tools-grid > button')).toHaveCount(4);
  await expect(page.locator('.tools-grid')).toContainText('Catalogue');
  await expect(page.locator('.tools-grid')).toContainText('Quick Replies');
  await expect(page.locator('.tools-grid')).toContainText('Import Contacts');
  await expect(page.locator('.tools-grid')).toContainText('Media / Documents');

  await navigation.getByRole('button', {name: /More/}).click();
  await expect(page.getByRole('heading', {name: 'More'})).toBeVisible();
  await expect(page.locator('.more-list')).toBeVisible();
  await expect(page.locator('.more-list')).toContainText('AI Settings');
  await expect(page.locator('.more-list')).toContainText('WhatsApp Connection');
  await expect(page.locator('.more-list')).toContainText('Business Profile');
  await expect(page.locator('.more-list')).toContainText('Basic Settings');
});

test('chat hides internal authors, quick replies work, and human takeover persists', async ({page}, testInfo) => {
  await page.getByRole('button', {name: /Dr. Arjun Mehta.*Can you share/}).click();
  await expect(page.getByText('AI Reply ON')).toHaveCount(0);
  await expect(page.locator('.ai-bar')).toHaveCount(0);
  await expect(page.locator('.message-author')).toHaveCount(0);
  await expect(page.getByText('Open Chet AI')).toHaveCount(0);

  await page.getByRole('button', {name: 'More conversation actions'}).click();
  await expect(page.getByRole('menu')).toContainText('Contact Info');
  await expect(page.getByRole('menu')).toContainText('Media / Documents');
  await expect(page.getByRole('menu')).toContainText('Catalogue');
  await page.getByRole('button', {name: 'Take Over', exact: true}).click();
  await page.getByRole('button', {name: 'More conversation actions'}).click();
  await expect(page.getByRole('button', {name: 'Resume AI', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'More conversation actions'}).click();

  const composer = page.getByRole('textbox', {name: 'Message', exact: true});
  await composer.fill('/wel');
  await expect(page.locator('.quick-suggestions')).toContainText('/welcome');
  await page.locator('.quick-suggestions button').first().click();
  await expect(composer).toHaveValue(/Thank you for reaching out/);
  await page.getByRole('button', {name: 'Send message'}).click();
  await expect(page.locator('.message-row.out').last()).toContainText('Thank you for reaching out');
  await page.getByRole('button', {name: 'More conversation actions'}).click();
  await expect(page.getByRole('button', {name: 'Resume AI', exact: true})).toBeVisible();

  await page.reload();
  if (testInfo.project.name === 'mobile') await page.locator('.conversation').filter({hasText: 'Dr. Arjun Mehta'}).click();
  await page.getByRole('button', {name: 'More conversation actions'}).click();
  await expect(page.getByRole('button', {name: 'Resume AI', exact: true})).toBeVisible();
});

test('catalogue uses vertical categories, horizontal six-product pages, and a detail sheet', async ({page}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', {name: /Dr. Arjun Mehta.*Can you share/}).click();
  await page.getByRole('button', {name: 'Open catalogue'}).click();
  const dialog = page.getByRole('dialog').filter({has: page.getByRole('heading', {name: 'Share catalogue'})});
  await expect(dialog).toBeVisible();
  const injection = dialog.getByRole('region', {name: 'Injection', exact: true});
  const tablet = dialog.getByRole('region', {name: 'Tablet', exact: true});
  await expect(injection).toBeVisible();
  const verticalPositions = await Promise.all([injection, tablet].map((locator) => locator.evaluate((element) => element.getBoundingClientRect().top)));
  expect(verticalPositions[1]).toBeGreaterThan(verticalPositions[0]);

  const rail = injection.getByLabel('Injection product pages');
  const railSize = await rail.evaluate((element) => ({client: element.clientWidth, scroll: element.scrollWidth}));
  expect(railSize.scroll).toBeGreaterThan(railSize.client);
  const firstPage = rail.locator('.catalogue-page').first();
  await expect(firstPage.locator('.catalogue-product')).toHaveCount(6);
  if (testInfo.project.name === 'mobile') {
    const layout = await firstPage.evaluate((element) => {
      const style = getComputedStyle(element);
      return {columns: style.gridTemplateColumns.split(' ').length, rows: style.gridTemplateRows.split(' ').length};
    });
    expect(layout).toEqual({columns: 3, rows: 2});
  }
  await injection.getByRole('button', {name: 'More Injection products'}).click();
  await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect(dialog.locator('.catalogue-product').getByText(/Send to chat/i)).toHaveCount(0);
  await expect(dialog).not.toContainText('INR 0');
  await expect(dialog).not.toContainText('₹0');

  await dialog.getByLabel('Search catalogue').fill('ceftriaxone');
  await expect(dialog.locator('.catalogue-product')).toHaveCount(1);
  await dialog.getByRole('button', {name: 'Details for Ceftriaxone'}).click();
  const sheet = dialog.getByRole('dialog', {name: 'Product details'});
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', {name: 'Send to chat'})).toBeVisible();
  if (testInfo.project.name === 'mobile') {
    const box = await sheet.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.y || 0) + (box?.height || 0)).toBeGreaterThan(800);
  }
  await sheet.getByRole('button', {name: 'Send to chat'}).click();
  await expect(dialog.getByRole('status')).toContainText('added to demo chat');
  await page.getByRole('button', {name: 'Close dialog'}).click();
  await expect(page.locator('.shared-product')).toHaveCount(1);
  await page.getByRole('button', {name: 'More conversation actions'}).click();
  await expect(page.getByRole('button', {name: 'Resume AI', exact: true})).toBeVisible();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('contacts open contact info and catalogue management exposes edit only in details', async ({page}, testInfo) => {
  const navigation = primaryNavigation(page, testInfo.project.name);
  await navigation.getByRole('button', {name: /Contacts/}).click();
  await page.getByRole('button', {name: /Dr. Arjun Mehta/}).click();
  const contactInfo = page.getByRole('complementary', {name: 'Contact Info'});
  await expect(contactInfo).toBeVisible();
  await expect(contactInfo).toContainText('Media, Links & Documents');
  await expect(contactInfo).toContainText('Tags');
  await expect(page.getByRole('button', {name: 'Message', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Close contact info'}).click();

  await navigation.getByRole('button', {name: /Tools/}).click();
  await page.getByRole('button', {name: /Catalogue.*Browse and manage/}).click();
  const dialog = page.getByRole('dialog').filter({has: page.getByRole('heading', {name: 'Catalogue', exact: true})});
  await expect(dialog.getByRole('button', {name: 'Add product'})).toBeVisible();
  await dialog.getByRole('button', {name: 'Details for Ceftriaxone'}).click();
  await expect(dialog.getByRole('button', {name: 'Edit product'})).toBeVisible();
  await expect(dialog.getByRole('button', {name: 'Send to chat'})).toHaveCount(0);
});
