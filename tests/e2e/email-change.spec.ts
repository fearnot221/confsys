import {test,expect} from '../helpers/browser-test.js';
import {randomUUID} from 'node:crypto';
import {register,login} from '../helpers/browser-account.js';
import {password} from '../helpers/auth.js';
test('new mailbox confirmation preserves local identity and revokes all old browser sessions',async({page,browser})=>{
 const email=`e2e-${randomUUID()}@example.invalid`,target=`e2e-${randomUUID()}@example.invalid`;
 await register(page,email);await login(page,email);
 const old=await browser.newContext(),oldPage=await old.newPage();
 try{
  await oldPage.goto(`${process.env.PUBLIC_APP_ORIGIN}/auth/login`);await oldPage.getByLabel('電子郵件').fill(email);await oldPage.getByLabel('密碼',{exact:true}).fill(password);await oldPage.getByRole('button',{name:'登入',exact:true}).click();await expect(oldPage.getByTestId('account-email')).toHaveText(email);
  await page.goto('/auth/email-change');await page.getByLabel('新電子郵件').fill(target);await page.getByLabel('目前密碼').fill(password);await page.getByRole('button',{name:'寄送新信箱確認信'}).click();await expect(page.getByRole('status')).toContainText('目前信箱尚未變更');
  let messageId:string|undefined;await expect.poll(async()=>{const result=await fetch(`${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${target}`)}`).then(r=>r.json());messageId=result.messages.find((m:{ID:string;Subject:string})=>m.Subject.includes('Confirm new email'))?.ID;return !!messageId;},{timeout:15000}).toBe(true);
  const message=await fetch(`${process.env.MAILPIT_URL}/api/v1/message/${messageId}`).then(r=>r.json()),link=String(message.Text).match(/http:\/\/[^\s]+\/auth\/email-change#token=[A-Za-z0-9_-]+/)?.[0];if(!link)throw new Error('Missing Mailpit confirmation link');
  await page.goto(link);await expect(page.getByRole('heading',{name:'確認新信箱'})).toBeVisible();await expect(page).toHaveURL(/\/auth\/email-change$/);
  await oldPage.reload();await expect(oldPage.getByTestId('account-email')).toHaveText(email);
  await page.getByLabel('目前密碼').fill(password);await page.getByRole('button',{name:'確認變更並撤銷既有登入'}).click();await expect(page.getByRole('status')).toContainText('所有原有登入已撤銷');
  await oldPage.reload();await expect(oldPage.getByTestId('account-email')).toHaveCount(0);await expect(oldPage.getByRole('alert')).toContainText('登入已逾期');
  await login(page,target);expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);
  await page.goto(link);await page.getByLabel('目前密碼').fill(password);await page.getByRole('button',{name:'確認變更並撤銷既有登入'}).click();await expect(page.getByRole('alert')).toContainText('確認連結已失效');
 }finally{await old.close();}
});
