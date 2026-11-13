import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {makeLevelFixture} from '../../lib/fixture.ts';
import {base,ready,create} from './support.ts';

// The app under test is a stand-in registered in the local D1; its callback address is answered by the test itself.
const callback='http://127.0.0.1:5199/callback',verifier='browser-verifier-'.repeat(4),challenge=createHash('sha256').update(verifier).digest('base64url');
const client=(...args:string[])=>execFileSync('node',['scripts/oauth-client.mjs',...args,'--local'],{encoding:'utf8'});
let clientId='';
test.beforeAll(()=>{clientId=client('add','--name','Browser Cafe','--redirect',callback,'--public').match(/client_id\s+(urai_[0-9a-f]{24})/)![1];});
test.afterAll(()=>{if(clientId)client('remove',clientId);});

test('the snapshot stays private until ticked, an app is authorized through the consent page, reads the profile, and is revoked on urai',async({page})=>{
 await ready(page);const s=await create(page,'OAuth Fixture');
 const r=await page.request.post('/api/collect/'+s.id,{headers:{Authorization:'Bearer '+s.writeToken,'Idempotency-Key':'browser-oauth-'+s.id},data:{...makeLevelFixture(s.nickname),kind:'observed'}});expect(r.status()).toBe(201);
 await expect(page.locator('.app-root')).toHaveAttribute('data-stage','reveal');
 await page.getByRole('button',{name:'分享卡片',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'挑個尺寸，分享這一面。'}),toggle=dialog.getByRole('checkbox',{name:/一併公開 AI 工作履歷快照/});
 await expect(toggle).not.toBeChecked();
 await dialog.getByRole('button',{name:'建立可驗證連結'}).click();
 const url=(await dialog.locator('.verify-link code').textContent())!;
 const view=await page.context().newPage();
 await view.goto(url);await expect(view.locator('.public-card h1')).toHaveText('OAuth Fixture');await expect(view.locator('.profile-stats')).toHaveCount(0);

 const authorize='/oauth/authorize?'+new URLSearchParams({client_id:clientId,redirect_uri:callback,response_type:'code',scope:'profile.read',state:'browser-state',code_challenge:challenge,code_challenge_method:'S256'});
 // An app cannot get in while the numbers are private: the consent page says what allowing would publish.
 await view.goto(authorize);
 await expect(view.locator('.oauth-screen h1')).toHaveText('「Browser Cafe」想讀取你的公開 AI 工作履歷');
 await expect(view.locator('.oauth-publish')).toBeVisible();await expect(view.getByRole('button',{name:'公開並允許'})).toBeVisible();

 await toggle.check();await dialog.getByRole('button',{name:'更新公開卡面'}).click();await expect(dialog.getByRole('status')).toHaveText('公開卡片已更新。');
 await view.goto(url);await expect(view.locator('.profile-stats')).toContainText('期間內工作階段');await expect(view.locator('.profile-stats')).toContainText('40');
 expect(await view.locator('.public-card').textContent()).not.toMatch(/T001|readToken/);

 await view.route(callback+'**',route=>route.fulfill({contentType:'text/plain',body:'callback'}));
 await view.goto(authorize);await expect(view.locator('.oauth-publish')).toHaveCount(0);
 await view.getByRole('button',{name:'允許',exact:true}).click();
 await view.waitForURL(callback+'**');
 const back=new URL(view.url());expect(back.searchParams.get('state')).toBe('browser-state');expect(back.searchParams.get('iss')).toBe(base);
 const issued=await page.request.post('/oauth/token',{form:{grant_type:'authorization_code',code:back.searchParams.get('code')!,redirect_uri:callback,client_id:clientId,code_verifier:verifier}});
 expect(issued.status()).toBe(200);const tokens=await issued.json() as {access_token:string};
 const read=()=>page.request.get('/api/me/profile',{headers:{Authorization:'Bearer '+tokens.access_token}});
 const profile=await read();expect(profile.status()).toBe(200);
 const body=await profile.json() as {url:string;generatedAt:string;nickname:string;snapshot:{stats:{sessions:number}}};
 expect(body.url).toBe(url);expect(body.nickname).toBe('OAuth Fixture');expect(body.snapshot.stats.sessions).toBe(40);expect(body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
 expect((await page.request.get('/api/me/profile')).status()).toBe(401);

 await view.goto('/oauth/grants');
 const grant=view.locator('.oauth-grants li');await expect(grant).toHaveCount(1);await expect(grant.locator('b')).toHaveText('Browser Cafe');
 await grant.getByRole('button',{name:'撤銷授權'}).click();await grant.getByRole('button',{name:'確定撤銷'}).click();
 await expect(view.locator('.oauth-empty')).toBeVisible();
 expect((await read()).status()).toBe(401);

 // Faulty requests: an unregistered return address is shown an error here; a wrong response type is reported to the app.
 await view.goto(authorize.replace(encodeURIComponent(callback),encodeURIComponent('https://evil.example/cb')));
 await expect(view.locator('.oauth-screen h1')).toHaveText('這個授權連結無效。');
 expect((await page.request.get('/oauth/grants')).headers()['content-security-policy']).toBe("frame-ancestors 'none'");
 const meta=await (await page.request.get('/.well-known/oauth-authorization-server')).json() as {issuer:string;code_challenge_methods_supported:string[]};
 expect(meta.issuer).toBe(base);expect(meta.code_challenge_methods_supported).toEqual(['S256']);
});
