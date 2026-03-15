// ================================================================
//  test_apply.js — Quick diagnostic test
//  Run: node test_apply.js
// ================================================================
require('dotenv').config();
const { loginLinkedIn, searchJobs, easyApply, closeBrowser } = require('./agents/linkedin');

const EMAIL    = process.env.TEST_EMAIL    || '';
const PASSWORD = process.env.TEST_PASSWORD || '';
const KEYWORDS = 'Software Engineer';
const LOCATION = 'India';

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('❌ Set TEST_EMAIL and TEST_PASSWORD in .env');
    process.exit(1);
  }

  console.log('\n🚀 Starting test...\n');

  // 1. Login
  console.log('1️⃣  Logging in...');
  const loginResult = await loginLinkedIn(EMAIL, PASSWORD);
  console.log('   Result:', loginResult);
  if (!loginResult.success) { await closeBrowser(); return; }

  // 2. Search
  console.log('\n2️⃣  Searching jobs...');
  const jobs = await searchJobs(KEYWORDS, LOCATION, 5);
  console.log(`   Found ${jobs.length} jobs`);
  jobs.forEach((j, i) => console.log(`   [${i}] ${j.title} @ ${j.company} — ${j.link}`));

  if (!jobs.length) { await closeBrowser(); return; }

  // 3. Apply to first job
  const job = jobs[0];
  console.log(`\n3️⃣  Applying to: ${job.title} @ ${job.company}`);
  const result = await easyApply(job.link);
  console.log('\n📊 Result:', result);

  if (result.success) {
    console.log('\n🎉 SUCCESS! Application submitted!');
  } else {
    console.log('\n👀 Check debug_screenshots/ folder for what happened');
  }

  await closeBrowser();
  console.log('\n✅ Test complete');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  closeBrowser().catch(() => {});
});
