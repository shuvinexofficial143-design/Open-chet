import {expect, test} from '@playwright/test';

test('unused Tools page is absent on desktop and mobile while existing sections work', async ({page}, info) => {
  await page.goto('/?demo=1');
  const nav=info.project.name==='mobile' ? page.locator('.mobile-nav') : page.locator('.mvp-sidebar nav');
  await expect(nav.getByRole('button', {name:'Tools',exact:true})).toHaveCount(0);
  await expect(page.locator('.tools-grid')).toHaveCount(0);
  const names=await nav.locator('button span').allTextContents();
  expect(names.map(name=>name.trim())).toEqual(['Chats','Contacts','More']);
  await nav.getByRole('button',{name:'Contacts'}).click();
  await expect(page.getByRole('heading',{name:'Contacts'})).toBeVisible();
  await nav.getByRole('button',{name:'More'}).click();
  await expect(page.getByRole('heading',{name:'More'})).toBeVisible();
  await nav.getByRole('button',{name:'Chats'}).click();
  await expect(page.locator('.conversation').first()).toBeVisible();
  await page.locator('.conversation').first().click();
  await page.getByRole('button',{name:'Open catalogue'}).click();
  await expect(page.getByRole('heading',{name:'Share catalogue'})).toBeVisible();
});
