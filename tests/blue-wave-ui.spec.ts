import {expect, test} from '@playwright/test';

test('selected royal-blue theme styles the actual Open Chet inbox on desktop and mobile', async ({page}, testInfo) => {
  await page.goto('/?demo=1');
  const app=page.locator('.mvp-app');
  await expect(app).toBeVisible();
  await expect(page.locator('.mobile-chats-heading strong')).toHaveText('Chats');
  const theme = await app.evaluate(element => {
    const style = getComputedStyle(element);
    return {primary:style.getPropertyValue('--green').trim(),side:style.backgroundColor};
  });
  expect(theme.primary).toBe('#1555f5');

  const allCount=await page.locator('.conversation').count();
  if(testInfo.project.name==='mobile'){
    const compact=page.locator('.chat-search-toolbar');
    const unread=compact.getByRole('button',{name:'Show unread chats'});
    await unread.click();
    await expect(compact.getByRole('button',{name:'Show all chats'})).toHaveAttribute('aria-pressed','true');
    const filtered=await page.locator('.conversation').count();
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(allCount);
    await compact.getByRole('button',{name:'Show all chats'}).click();
    await expect(page.locator('.conversation')).toHaveCount(allCount);
  } else {
    const filter=page.getByRole('group',{name:'Filter chats'});
    const all=filter.getByRole('button',{name:'All chats'});
    const unread=filter.getByRole('button',{name:/Unread/});
    await expect(all).toHaveAttribute('aria-pressed','true');
    await unread.click();
    await expect(unread).toHaveAttribute('aria-pressed','true');
    const filtered=await page.locator('.conversation').count();
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(allCount);
    await all.click();
    await expect(page.locator('.conversation')).toHaveCount(allCount);
  }
  const plus=page.getByRole('button',{name:'New conversation'}).filter({visible:true});
  await expect(plus).toBeVisible();
  const buttonStyle=await plus.evaluate(element=>({image:getComputedStyle(element).backgroundImage,color:getComputedStyle(element).backgroundColor}));
  expect(buttonStyle.image.includes('gradient')||buttonStyle.color==='rgb(21, 85, 245)').toBe(true);

  await page.locator('.conversation').first().click();
  await expect(page.locator('.chat-header')).toBeVisible();
  await expect(page.getByRole('button',{name:'Open catalogue'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Send message'})).toBeVisible();
  const outgoing=page.locator('.message-bubble.out').first();
  await expect(outgoing).toBeVisible();
  expect(await outgoing.evaluate(element=>getComputedStyle(element).backgroundColor)).toBe('rgb(224, 245, 231)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  if(testInfo.project.name==='mobile'){
    await page.getByRole('button',{name:'Back to chats'}).click();
    await expect(page.locator('.chat-search-toolbar')).toBeVisible();
    const nav=page.locator('.mobile-nav');
    await expect(nav.locator('button span')).toHaveText(['Chats','Contacts','More']);
    await nav.getByRole('button',{name:'Contacts'}).click();
    await expect(page.getByRole('heading',{name:'Contacts'})).toBeVisible();
  }
});

test('single-password login uses the blue theme without requiring phone or OTP',async({page})=>{
  await page.goto('/login');
  await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
  await expect(page.locator('input[name=password]')).toBeVisible();
  await expect(page.getByText('Enter your private password')).toBeVisible();
  await expect(page.locator('input[name=otp], input[name=mobile]')).toHaveCount(0);
  const primary=page.locator('.login-card .primary');
  await expect(primary).toBeVisible();
  expect(await primary.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(21, 85, 245)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});


test('blue chat wallpaper uses subtle layered waves with no repeating dot grid', async ({page}) => {
  await page.goto('/?demo=1');
  await page.locator('.conversation').first().click();
  const wallpaper=page.locator('.messages');
  await expect(wallpaper).toBeVisible();
  const style=await wallpaper.evaluate(node=>{
    const css=getComputedStyle(node);
    return {image:css.backgroundImage,size:css.backgroundSize,repeat:css.backgroundRepeat,position:css.backgroundPosition};
  });
  expect(style.image.match(/radial-gradient/g)?.length).toBe(4);
  expect(style.image).not.toContain('1px 1px');
  expect(style.size.split(', ').length).toBe(5);
  expect(style.size.split(', ').every(layer => layer === '100% 100%')).toBe(true);
  expect(style.repeat.split(', ').every(layer => layer === 'no-repeat')).toBe(true);
  await expect(page.locator('.message-bubble').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
