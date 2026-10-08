import {expect, test} from '@playwright/test';
import {demoData} from '../lib/demo';

const imageOnePixel=Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlHWc0AAAAASUVORK5CYII=',
  'base64'
);

test('received WhatsApp medicine photo displays inline and opens a full-size preview', async ({page}) => {
  const d=demoData();
  const first=d.conversations[0];
  const sample=d.messages.find(m => m.conversation_id === first.id) || d.messages[0];
  const id='bb111111-1111-4111-8111-111111111111';
  d.messages.push({
    ...sample,id,conversation_id:first.id,
    body:'[image]',kind:'image',direction:'in',
    media_id:'meta-123',media_url:undefined,
    created_at:new Date().toISOString(),status:'received',sender_name:'Customer',
  });
  await page.addInitScript(data => localStorage.setItem('open-chet-demo-v1',JSON.stringify(data)),d);
  let requested=0;
  await page.route('**/api/media?message=*&inline=1', async route => {
    requested++;
    await route.fulfill({status:200,contentType:'image/png',body:imageOnePixel});
  });
  await page.goto('/?demo=1');
  await page.locator('.conversation').first().click();

  const image=page.getByRole('img',{name:'Photo shared in conversation'});
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element:HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  expect(requested).toBeGreaterThan(0);
  await expect(page.getByText('[image]',{exact:true})).toHaveCount(0);

  await page.getByRole('button',{name:'View customer photo'}).click();
  const preview=page.getByRole('dialog',{name:'Photo preview'});
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('img',{name:'Full-size photo shared in conversation'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
});

test('unavailable WhatsApp photo offers clear fallback instead of a broken image',async({page})=>{
  const d=demoData();
  const first=d.conversations[0];
  const sample=d.messages.find(m=>m.conversation_id===first.id)||d.messages[0];
  d.messages.push({...sample,id:'bb222222-2222-4222-8222-222222222222',
    conversation_id:first.id,kind:'image',direction:'in',
    body:'[image]',media_id:'expired-media',media_url:undefined,
    created_at:new Date().toISOString(),status:'received',sender_name:'Customer'});
  await page.addInitScript(data=>localStorage.setItem('open-chet-demo-v1',JSON.stringify(data)),d);
  await page.route('**/api/media?message=*&inline=1',route=>route.fulfill({status:404,body:'Expired'}));
  await page.goto('/?demo=1');
  await page.locator('.conversation').first().click();
  await expect(page.getByText('Photo unavailable',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry photo'})).toBeVisible();
});
