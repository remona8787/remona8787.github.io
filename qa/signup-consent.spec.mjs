// Sign-up asks for the age and policy confirmation (privacy policy and terms 2.0.0, docs/policies/v2-final.md): without
// the box ticked no request leaves the page; with it, the confirmation travels with the sign-up and is kept as the
// account's metadata. Signing in never asks for it. A stand-in Auth server (page.route) answers; the real one is
// covered by qa/real-backend.spec.mjs against a local Supabase.
import {test,expect} from './fixtures.mjs';

const URL_='https://consent-test.supabase.co',KEY='sb_publishable_consenttest';
async function wire(page){
 const seen=[];
 await page.route('**/config.js',r=>r.request().url().includes('/admin/')?r.fallback():r.fulfill({contentType:'text/javascript',body:`window.AOL_CONFIG=Object.assign(window.AOL_CONFIG||{},{SUPABASE_URL:${JSON.stringify(URL_)},SUPABASE_PUBLISHABLE_KEY:${JSON.stringify(KEY)},PUBLIC_URL:location.origin});`}));
 await page.route(URL_+'/**',async r=>{
  const u=new URL(r.request().url());seen.push({path:u.pathname,method:r.request().method(),body:r.request().postDataJSON?.()??null});
  if(u.pathname==='/auth/v1/signup')return r.fulfill({contentType:'application/json',body:JSON.stringify({id:'00000000-0000-4000-8000-000000000001',aud:'authenticated',role:'',email:'new@example.com',user_metadata:{},identities:[{id:'x'}],created_at:new Date().toISOString()})});
  if(u.pathname==='/auth/v1/token')return r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'invalid_grant',error_description:'Invalid login credentials'})});
  return r.fulfill({contentType:'application/json',body:u.pathname.startsWith('/rest/')?'[]':'{}'});
 });
 return seen;
}

test('sign-up needs the age and policy confirmation; it is sent with the sign-up; sign-in does not ask for it',async({page})=>{
 const seen=await wire(page);
 await page.goto('/#account');
 const form=page.locator('#authForm');
 await expect(form).toBeVisible();
 await expect(form.getByRole('link',{name:'이용약관'})).toHaveAttribute('href','./terms.html');
 await expect(form.getByRole('link',{name:'개인정보 처리방침'})).toHaveAttribute('href','./privacy.html');
 await form.getByLabel('이메일').fill('new@example.com');
 await form.getByLabel('비밀번호 (12자 이상)').fill('a-long-password-123');
 await form.getByRole('button',{name:'회원가입'}).click();
 await expect(page.locator('#accountMessage')).toContainText('만 14세 이상인지 확인하고');
 expect(seen.filter(s=>s.path==='/auth/v1/signup'),'nothing is sent without the confirmation').toHaveLength(0);
 // Signing in is not held up by the box.
 await form.getByRole('button',{name:'로그인',exact:true}).click();
 await expect.poll(()=>seen.some(s=>s.path==='/auth/v1/token')).toBe(true);
 await form.getByLabel(/만 14세 이상이며/).check();
 await form.getByRole('button',{name:'회원가입'}).click();
 await expect.poll(()=>seen.find(s=>s.path==='/auth/v1/signup')?.body?.data?.consent||null).toMatchObject({age_14_plus:true,terms_version:'2.0.0',privacy_version:'2.0.0'});
 const sent=seen.find(s=>s.path==='/auth/v1/signup').body;
 expect(Date.parse(sent.data.consent.consented_at)).toBeGreaterThan(Date.now()-60000);
});
