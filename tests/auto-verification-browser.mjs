// Real sign-up handlers and built client, synthetic imported register in navigation fixture.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base=process.env.TEST_BASE||'http://127.0.0.1:5188';
await fs.mkdir('artifacts/auto-verification',{recursive:true});
const browser=await chromium.launch({headless:true});
try {
  for(const [profession,number] of [['Doctor','MP 0123456'],['Nurse','12345678']]){
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/#/portal');await page.getByRole('button',{name:'Create account',exact:true}).click();
    await page.getByLabel('Full name *',{exact:true}).fill('QA Matching Referrer');
    if(profession==='Nurse'){await page.getByRole('combobox',{name:'Profession',exact:true}).click();await page.getByRole('option',{name:'Nurse',exact:true}).click();}
    await page.getByLabel('Specialty *',{exact:true}).fill('Emergency');
    await page.getByLabel('Professional registration no. (optional)',{exact:true}).fill(number);
    await page.getByLabel('Email *',{exact:true}).fill(`qa-auto-${profession.toLowerCase()}@example.invalid`);
    await page.getByLabel('Cellphone *',{exact:true}).fill('0700000000');
    await page.getByRole('button',{name:'Continue to account',exact:true}).click();
    await page.getByLabel('Username *',{exact:true}).fill(`qa_auto_${profession.toLowerCase()}`);
    await page.getByLabel('Password *',{exact:true}).fill('navigation-test-password');
    const response=page.waitForResponse(r=>r.url().endsWith('/api/referrer/signup')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Create account',exact:true}).click();
    const signup=await response;assert.equal(signup.status(),200);assert.equal((await signup.json()).autoApproved,true);
    await page.getByText('Verified',{exact:true}).waitFor({state:'visible'});
    assert.equal(await page.getByText('Verification pending',{exact:true}).count(),0);
    assert.equal(await page.getByLabel('Staff card photo',{exact:true}).count(),0);
    await page.screenshot({path:`artifacts/auto-verification/${profession.toLowerCase()}-verified.png`});
    await page.getByRole('button',{name:'New consult',exact:true}).click();
    await page.getByRole('heading',{name:'New referral',exact:true}).waitFor({state:'visible'});
    await page.getByTestId('select-team').waitFor({state:'visible'});
    assert.deepEqual(errors,[]);console.log(`PASS ${profession}: matching record -> automatic verified sign-up -> referral form, no card or admin approval`);
    await context.close();
  }
}finally{await browser.close();}
