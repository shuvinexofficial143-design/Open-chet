import {expect,test} from '@playwright/test';
import {demoData} from '../lib/demo';

test('customer rows have separators and chat header shows customer number only', async ({page}, testInfo) => {
  const data=demoData();
  const customer=data.contacts[0];
  const businessNumber='+91 92034 77793';
  data.connection!.whatsapp_accounts=[
    {id:'test-account', label:'SCM PHARMACY', phone_number_id:'12345678',
      business_account_id:'87654321', display_phone_number:businessNumber,
      verified_name:'SCM PHARMACY',is_active:true,is_default:true},
  ];
  data.conversations[0].whatsapp_account_id='test-account';
  await page.addInitScript(value => localStorage.setItem('open-chet-demo-v1', JSON.stringify(value)), data);
  await page.goto('/?demo=1');

  const rows=page.locator('.conversation');
  await expect(rows.first()).toBeVisible();
  const divider=await rows.nth(1).evaluate(element=>{
    const style=getComputedStyle(element);
    return {width:style.borderBottomWidth,style:style.borderBottomStyle,color:style.borderBottomColor};
  });
  expect(divider.width).toBe('1px');
  expect(divider.style).toBe('solid');
  expect(divider.color).not.toBe('rgba(0, 0, 0, 0)');
  await expect(rows.first()).not.toContainText(businessNumber);

  await rows.first().click();
  const header=page.locator('.chat-header .contact-heading');
  await expect(header.locator('strong')).toHaveText(customer.name);
  await expect(header.locator('small.customer-phone')).toHaveText(customer.phone);
  await expect(header).not.toContainText(businessNumber);
  await expect(header).not.toContainText('via');

  if(testInfo.project.name==='mobile') {
    await page.getByRole('button',{name:'Back to chats'}).click();
    await expect(rows.nth(1)).toBeVisible();
    await rows.nth(1).click();
    await expect(page.locator('.chat-header .customer-phone')).toHaveText(data.contacts[1].phone);
  }
});
