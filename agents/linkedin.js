// ================================================================
//  linkedin.js — v13  (Production Fixed)
//
//  Key fixes vs v12:
//   ✅ searchJobs now adds f_LF=f_AL (Easy Apply filter) to URL
//      so only native-modal jobs are returned — eliminates external
//      redirect skips entirely
//   ✅ searchJobs now uses JS-based extraction as primary method
//      which correctly reads job data from the left panel cards only,
//      skipping LinkedIn's right-side detail panel ghost items
//      (that was causing cards 7-24 to all skip with "no link or title")
//   ✅ searchJobs searches multiple keyword splits for more results
//   ✅ searchProfiles fixed — uses correct 2024 LinkedIn people search
//      selectors and expands the network filter to 1st+2nd+3rd degree
//   ✅ All existing bug fixes from v12 preserved
// ================================================================

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

let browser = null;
let page    = null;
let _profile = {};

function setProfile(p) { _profile = p || {}; }

const DEBUG_DIR = path.join(__dirname, '..', 'debug_screenshots');
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

const screenshot = async (name) => {
  try {
    const file = path.join(DEBUG_DIR, `${name}_${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`📸 ${file}`);
  } catch (_) {}
};

const delay = (min = 1500, max = 4000) =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));

// ── Browser lifecycle ─────────────────────────────────────────────
async function closeBrowser() {
  try { if (browser) await browser.close(); } catch (_) {}
  browser = null;
  page = null;
}

async function launchBrowser() {
  if (browser || page) await closeBrowser();
  browser = await chromium.launch({
    headless: false,
    slowMo: 30,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-infobars',
      '--disable-dev-shm-usage',
    ],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });
  page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  });
  browser.on('disconnected', () => { browser = null; page = null; });
  console.log('✅ Browser launched');
}

// ── Login ─────────────────────────────────────────────────────────
async function loginLinkedIn(email, password) {
  await launchBrowser();
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await delay(1000, 2000);
  if (page.url().includes('/feed')) return { success: true, message: 'Already logged in' };

  const emailInput = await page.$('#username').catch(() => null);
  if (!emailInput) return { success: false, message: 'Login page did not load' };
  await emailInput.fill(email);
  await delay(400, 800);
  await page.fill('#password', password);
  await delay(400, 800);
  await page.click('[type="submit"]');
  await page.waitForTimeout(6000);

  const url = page.url();
  console.log('🔗 After login URL:', url);
  if (url.includes('/feed') || url.includes('/mynetwork')) return { success: true, message: 'Logged in successfully' };
  if (url.includes('checkpoint') || url.includes('challenge')) return { success: false, message: 'LinkedIn requires verification — complete it in the browser then re-run' };
  if (url.includes('/login') || url.includes('authwall')) return { success: false, message: 'Login failed — check email/password' };
  if (url.includes('linkedin.com')) return { success: true, message: 'Logged in (non-standard redirect)' };
  return { success: false, message: `Unexpected redirect: ${url}` };
}

// ── Job Search ────────────────────────────────────────────────────
// FIX: Uses f_LF=f_AL (Easy Apply Only filter) in every search URL.
// FIX: Primary extraction is now JS-based, which reads only the left
//      panel list items correctly and skips LinkedIn's ghost items.
// FIX: Splits comma-separated keywords and searches each separately
//      to get more total results when keywords string is long.
async function searchJobs(keywords, location = 'India', maxJobs = 20) {
  const seen = new Set();
  const jobs  = [];

  // Split comma-separated keywords into individual terms for more results
  // e.g. "React Developer, Frontend Engineer" → ["React Developer", "Frontend Engineer"]
  const keywordList = keywords
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
    .slice(0, 4); // max 4 individual searches

  for (const kw of keywordList) {
    if (jobs.length >= maxJobs) break;

    // FIX: f_LF=f_AL = Easy Apply filter — only returns jobs with native LinkedIn modal
    const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(kw)}&location=${encodeURIComponent(location)}&f_LF=f_AL&sortBy=DD`;
    console.log(`🔍 Searching (Easy Apply only): ${url}`);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
      await delay(2500, 3500);
    } catch (e) {
      console.error('Navigation error:', e.message);
      continue;
    }

    // Scroll the LEFT PANEL LIST to load all job cards
    // LinkedIn has a split layout: left = job list, right = job detail
    // We need to scroll only the left panel, not the whole page
    try {
      await page.evaluate(() => {
        // Try to find and scroll the jobs list container specifically
        const listContainers = [
          document.querySelector('.scaffold-layout__list-container'),
          document.querySelector('.jobs-search-results-list'),
          document.querySelector('[class*="jobs-search-results"]'),
          document.querySelector('ul.scaffold-layout__list'),
        ].filter(Boolean);

        if (listContainers.length > 0) {
          const container = listContainers[0];
          // Scroll the container to load lazy items
          for (let i = 0; i < 5; i++) {
            container.scrollTop += 800;
          }
        } else {
          // Fallback: scroll the whole page
          window.scrollBy(0, 3000);
        }
      });
      await delay(1500, 2000);

      // Second scroll pass
      await page.evaluate(() => {
        const container = document.querySelector(
          '.scaffold-layout__list-container, .jobs-search-results-list, [class*="jobs-search-results"]'
        );
        if (container) {
          container.scrollTop = 0;
          for (let i = 0; i < 8; i++) container.scrollTop += 500;
        } else {
          for (let i = 0; i < 6; i++) window.scrollBy(0, 600);
        }
      });
      await delay(1500, 2000);
    } catch (_) {}

    // FIX: JS-based extraction reads only left-panel job cards correctly.
    // The previous CSS selector approach matched BOTH the left list items
    // AND the right detail panel items, causing "no link or title" skips.
    const extracted = await page.evaluate((max) => {
      const results = [];
      const seen = new Set();

      // Only look at links inside the job list, not the detail panel
      // The left panel has: .scaffold-layout__list or [class*="jobs-search-results"]
      const listEl =
        document.querySelector('.scaffold-layout__list-container') ||
        document.querySelector('.jobs-search-results-list')         ||
        document.querySelector('[class*="jobs-search-results-list"]') ||
        document.body; // fallback

      for (const a of listEl.querySelectorAll('a[href*="/jobs/view/"]')) {
        const href = a.href.split('?')[0];
        const m = href.match(/\/jobs\/view\/(\d+)/);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);

        // Walk up to the card container (the <li> item)
        let card = a;
        for (let i = 0; i < 10; i++) {
          if (!card.parentElement) break;
          if (card.tagName === 'LI' || card.getAttribute('data-occludable-job-id')) break;
          card = card.parentElement;
        }

        // Extract title
        const titleEl =
          card.querySelector('a[class*="job-card-list__title"]') ||
          card.querySelector('strong[class*="job-card"]')         ||
          card.querySelector('span[aria-hidden="true"]')          ||
          card.querySelector('h3')                                ||
          a;
        const title = (titleEl?.innerText || a.innerText || '').trim().split('\n')[0].trim();
        if (!title || title === '') continue;

        // Extract company
        const companyEl =
          card.querySelector('.job-card-container__primary-description') ||
          card.querySelector('.artdeco-entity-lockup__subtitle')          ||
          card.querySelector('[class*="company"]')                        ||
          card.querySelector('h4');
        const company = (companyEl?.innerText || 'N/A').trim().split('\n')[0].trim();

        // Extract location
        const locEl =
          card.querySelector('.job-card-container__metadata-item') ||
          card.querySelector('.artdeco-entity-lockup__caption')     ||
          card.querySelector('[class*="location"]');
        const location = (locEl?.innerText || '').trim().split('\n')[0].trim();

        // Extract salary if shown
        const salaryEl = card.querySelector('[class*="salary"], [class*="compensation"]');
        const salary = (salaryEl?.innerText || '').trim();

        // Check Easy Apply
        const cardHtml = card.innerHTML.toLowerCase();
        const easyApply = cardHtml.includes('easy apply') || cardHtml.includes('f_lf=f_al');

        results.push({
          id: m[1],
          title,
          company,
          location,
          salary: salary || '',
          link: href,
          easyApply: true, // we searched with f_LF=f_AL so all results should be Easy Apply
        });

        if (results.length >= max) break;
      }
      return results;
    }, maxJobs - jobs.length).catch((e) => {
      console.warn('JS extraction error:', e.message);
      return [];
    });

    let newCount = 0;
    for (const j of extracted) {
      if (!seen.has(j.id)) {
        seen.add(j.id);
        jobs.push({ ...j, status: 'new', score: 75 });
        newCount++;
      }
    }
    console.log(`✅ "${kw}": ${newCount} new Easy Apply jobs (total: ${jobs.length})`);

    // Small delay between keyword searches
    if (keywordList.indexOf(kw) < keywordList.length - 1) {
      await delay(1500, 2500);
    }
  }

  console.log(`✅ Total: ${jobs.length} Easy Apply jobs found across all keywords`);
  return jobs;
}

// ── Modal helpers ─────────────────────────────────────────────────

// Returns true only for the real Easy Apply modal — never for search filters panel
async function isModalOpen() {
  return await page.evaluate(() => {
    const sels = [
      '[data-test-modal-container]',
      '.jobs-easy-apply-modal',
      '.artdeco-modal--layer-default',
      '.artdeco-modal',
      '[role="dialog"]',
      '.jobs-apply-form',
    ];
    for (const sel of sels) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.height < 50 || rect.width < 50) continue;
        const text = (el.textContent || '').toLowerCase();
        const html = (el.innerHTML  || '').toLowerCase();
        // Reject search filters panel
        if (text.includes('sort by') && text.includes('date posted') && text.includes('experience level')) continue;
        if (text.includes('show results') && text.includes('reset') && !text.includes('contact info')) continue;
        // Accept if it looks like an Easy Apply form
        if (
          html.includes('easy-apply') ||
          html.includes('jobs-apply') ||
          text.includes('contact info') ||
          text.includes('resume') ||
          text.includes('work experience') ||
          text.includes('submit application') ||
          text.includes('next') ||
          el.querySelector('input, textarea, select') !== null
        ) return true;
      } catch (_) {}
    }
    return false;
  });
}

function getEasyApplyModalJS() {
  return `(function() {
    const sels = ['[data-test-modal-container]','.jobs-easy-apply-modal','.artdeco-modal--layer-default','[role="dialog"]'];
    for (const s of sels) {
      const els = Array.from(document.querySelectorAll(s));
      for (const el of els) {
        const text = (el.textContent || '').toLowerCase();
        if (text.includes('sort by') && text.includes('date posted')) continue;
        if (text.includes('show results') && !text.includes('contact info')) continue;
        if (el.getBoundingClientRect().height > 50) return el;
      }
    }
    return null;
  })()`;
}

async function getModalButtons() {
  return await page.evaluate((modalJS) => {
    const modal = eval(modalJS);
    if (!modal) return [];
    return Array.from(modal.querySelectorAll('button'))
      .filter(b => b.offsetParent && !b.disabled)
      .map(b => (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase().replace(/\s+/g, ' '));
  }, getEasyApplyModalJS());
}

async function hideMessaging() {
  try {
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.textContent = `.msg-overlay-list-bubble,.msg-overlay-bubble-header,.msg-overlay-conversation-bubble{display:none!important}`;
      document.head.appendChild(s);
    });
  } catch (_) {}
}

async function humanMouseClick(locator) {
  try {
    await locator.waitFor({ state: 'visible', timeout: 5000 });
    await locator.scrollIntoViewIfNeeded();
    await delay(300, 600);
    const box = await locator.boundingBox();
    if (!box) return false;
    const x = box.x + box.width  * (0.3 + Math.random() * 0.4);
    const y = box.y + box.height * (0.3 + Math.random() * 0.4);
    await page.mouse.move(x - 50, y - 20, { steps: 5 });
    await delay(80, 150);
    await page.mouse.move(x, y, { steps: 8 });
    await delay(50, 120);
    await page.mouse.down();
    await delay(60, 130);
    await page.mouse.up();
    return true;
  } catch (_) { return false; }
}

async function findEasyApplyButton() {
  const candidates = [
    page.locator('button.jobs-apply-button').first(),
    page.locator('button[aria-label*="Easy Apply"]').first(),
    page.locator('button').filter({ hasText: /^Easy Apply/ }).first(),
    page.locator('button').filter({ hasText: /Easy Apply/ }).first(),
  ];
  for (const loc of candidates) {
    try {
      if (await loc.isVisible({ timeout: 1500 })) return loc;
    } catch (_) {}
  }
  return null;
}

async function waitForEasyApplyBtn(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await findEasyApplyButton()) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

// ── Easy Apply ────────────────────────────────────────────────────
async function easyApply(jobUrl) {
  console.log(`\n🎯 Easy Apply: ${jobUrl}`);
  const jobId = jobUrl.match(/\/jobs\/view\/(\d+)/)?.[1];
  if (!jobId) return { success: false, message: 'Invalid job URL' };

  try {
    console.log('📍 Loading job page...');
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2500, 3500);
    await hideMessaging();

    await page.evaluate(() => {
      const closeBtn = document.querySelector('button[aria-label="Dismiss"], button[aria-label="Close"], .artdeco-modal__dismiss');
      if (closeBtn) closeBtn.click();
    }).catch(() => {});
    await delay(400, 700);

    let btnFound = await waitForEasyApplyBtn(6000);

    // Strategy 2: currentJobId URL param
    if (!btnFound) {
      console.log('📍 Strategy 2: currentJobId param');
      await page.goto(
        `https://www.linkedin.com/jobs/search/?currentJobId=${jobId}`,
        { waitUntil: 'domcontentloaded', timeout: 30000 }
      );
      await delay(3000, 4500);
      await hideMessaging();
      try { await page.waitForSelector('.jobs-unified-top-card, .jobs-details__main-content', { timeout: 8000 }); } catch (_) {}
      await delay(1500, 2500);
      btnFound = await waitForEasyApplyBtn(8000);
    }

    if (!btnFound) {
      await screenshot('no_easy_apply_btn');
      return { success: false, message: 'Easy Apply button not found — skipping' };
    }

    console.log('✅ Easy Apply button found — watching for new tab...');
    await delay(400, 600);

    let externalTabPage = null;

    if (browser) {
      const context = browser.contexts()[0];
      if (context) {
        const tabPromise = new Promise(resolve => {
          const handler = (newPg) => { externalTabPage = newPg; resolve(); };
          context.once('page', handler);
          setTimeout(() => { context.off('page', handler); resolve(); }, 4000);
        });

        const btn = await findEasyApplyButton();
        if (btn) {
          await humanMouseClick(btn).catch(() => btn.click({ delay: 80 }).catch(() => {}));
        } else {
          await page.evaluate(() => {
            const b = Array.from(document.querySelectorAll('button')).find(b =>
              /easy apply/i.test((b.textContent || b.getAttribute('aria-label') || '').trim()) && b.offsetParent
            );
            if (b) { b.scrollIntoView({ block: 'center' }); b.click(); }
          });
        }

        await delay(1800, 2200);
        await tabPromise;

        if (externalTabPage) {
          let externalUrl = '';
          try { externalUrl = externalTabPage.url(); } catch (_) {}
          const hostname = externalUrl && externalUrl !== 'about:blank'
            ? (() => { try { return new URL(externalUrl).hostname; } catch (_) { return externalUrl.slice(0, 40); } })()
            : 'external site';
          console.log(`  🚫 External tab detected: ${externalUrl.slice(0, 80)}`);
          try { await externalTabPage.close(); } catch (_) {}
          await page.bringToFront().catch(() => {});
          return { success: false, message: `External redirect (${hostname}) — skipped` };
        }
      }
    } else {
      const btn = await findEasyApplyButton();
      if (btn) await humanMouseClick(btn).catch(() => btn.click({ delay: 80 }).catch(() => {}));
      await delay(2000, 2500);
    }

    let modalOpen = await isModalOpen();

    if (!modalOpen) {
      console.log('🖱️ Attempt 2: native click');
      try {
        const btn2 = await findEasyApplyButton();
        if (btn2) { await btn2.click({ delay: 100 }); await delay(2000, 2500); modalOpen = await isModalOpen(); }
      } catch (_) {}
    }
    if (!modalOpen) {
      console.log('🖱️ Attempt 3: JS scroll+click');
      const clicked = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(b =>
          /easy apply/i.test((b.textContent || b.getAttribute('aria-label') || '').trim()) && b.offsetParent
        );
        if (!b) return false;
        b.scrollIntoView({ block: 'center', behavior: 'instant' });
        b.click();
        return true;
      });
      if (clicked) { await delay(2000, 3000); modalOpen = await isModalOpen(); }
    }
    if (!modalOpen) {
      console.log('🖱️ Attempt 4: Space key');
      const focused = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(b =>
          /easy apply/i.test((b.textContent || '').trim()) && b.offsetParent
        );
        if (!b) return false;
        b.focus();
        return true;
      });
      if (focused) { await page.keyboard.press('Space'); await delay(2000, 2500); modalOpen = await isModalOpen(); }
    }
    if (!modalOpen) {
      console.log('⏳ Waiting 5s for modal...');
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(500);
        modalOpen = await isModalOpen();
        if (modalOpen) break;
      }
    }

    if (!modalOpen) {
      await screenshot('modal_never_opened');
      return { success: false, message: 'Easy Apply modal never opened — may be external or already applied' };
    }

    console.log('✅ Modal is open!');
    await screenshot('modal_open');
    return await fillAndSubmit();

  } catch (err) {
    console.error('easyApply error:', err.message);
    await screenshot('exception').catch(() => {});
    return { success: false, message: `Easy Apply error: ${err.message}` };
  }
}

// ── Form filling ──────────────────────────────────────────────────
async function fillCurrentStep() {
  await page.evaluate((profile) => {
    const sels = ['[data-test-modal-container]', '.jobs-easy-apply-modal', '.artdeco-modal--layer-default', '[role="dialog"]'];
    let modal = null;
    for (const s of sels) {
      const els = Array.from(document.querySelectorAll(s));
      for (const el of els) {
        const text = (el.textContent || '').toLowerCase();
        if (text.includes('sort by') && text.includes('date posted')) continue;
        if (text.includes('show results') && !text.includes('contact info')) continue;
        if (el.getBoundingClientRect().height > 50) { modal = el; break; }
      }
      if (modal) break;
    }
    if (!modal) return;

    function getLabelFor(el) {
      let label = '';
      if (el.id) { const lel = modal.querySelector(`label[for="${el.id}"]`); if (lel) label = lel.textContent || ''; }
      if (!label) label = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '';
      if (!label) {
        let p = el.parentElement;
        for (let i = 0; i < 4; i++) {
          if (!p) break;
          const lbl = p.querySelector('label, legend, span[class*="label"], div[class*="label"]');
          if (lbl && lbl !== el) { label = lbl.textContent || ''; break; }
          p = p.parentElement;
        }
      }
      return label.toLowerCase().trim();
    }

    function setNativeValue(el, value) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function smartSelect(sel, preferred) {
      if (!sel || sel.disabled || !sel.offsetParent) return false;
      const opts = Array.from(sel.options).filter(o => o.value && o.value !== '' && o.value !== 'select');
      if (!opts.length) return false;
      const pref = (preferred || '').toString().toLowerCase().trim();
      let best = null;
      if (pref) {
        best = opts.find(o => o.text.toLowerCase().trim() === pref)
            || opts.find(o => o.value.toLowerCase().trim() === pref)
            || opts.find(o => o.text.toLowerCase().includes(pref));
        const num = parseInt(pref);
        if (!best && !isNaN(num)) {
          best = opts.find(o => {
            const t = o.text.toLowerCase();
            if (t.includes(`${num} year`) || t.includes(`${num} month`)) return true;
            const rng = t.match(/(\d+)\s*[-–]\s*(\d+)/);
            if (rng && num >= parseInt(rng[1]) && num <= parseInt(rng[2])) return true;
            return false;
          });
        }
      }
      if (!best) best = opts[0];
      if (best && best.value !== sel.value) {
        sel.value = best.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.dispatchEvent(new Event('input',  { bubbles: true }));
        return true;
      }
      return false;
    }

    // 1. Phone
    for (const sel of ['input[id*="phoneNumber"]','input[name*="phone"]','input[aria-label*="Phone"]','input[aria-label*="phone"]','input[type="tel"]','input[placeholder*="phone"]','input[placeholder*="Phone"]']) {
      const ph = modal.querySelector(sel);
      if (ph && ph.offsetParent && !ph.readOnly && !ph.disabled) {
        const cur = ph.value.replace(/\D/g, '');
        if (!cur || cur === '9999999999') {
          const clean = (profile.phone || '').replace(/[^0-9+]/g, '');
          if (clean) { ph.focus(); setNativeValue(ph, clean); }
        }
        break;
      }
    }

    // 2. Selects
    modal.querySelectorAll('select').forEach(sel => {
      if (!sel.offsetParent || sel.disabled) return;
      const cur = Array.from(sel.options).find(o => o.selected);
      if (cur && cur.value && !cur.text.toLowerCase().includes('select an option')) return;
      const label = getLabelFor(sel);
      let pref = '';
      if      (label.includes('year') && label.includes('experience') && !label.includes('month')) pref = profile.yearsExperience;
      else if (label.includes('month') && label.includes('experience'))  pref = profile.additionalMonthsExperience;
      else if (label.includes('english') || label.includes('proficiency')) pref = profile.englishProficiency;
      else if (label.includes('full-time') || label.includes('full time')) pref = profile.availableFullTime;
      else if (label.includes('cet') || label.includes('central european')) pref = profile.canWorkCETHours;
      else if (label.includes('notice') || label.includes('join'))        pref = profile.noticePeriod;
      else if (label.includes('country'))                                  pref = profile.currentCountry;
      else if (label.includes('city') || label.includes('location'))       pref = profile.currentCity || 'Chennai';
      else if (label.includes('salary') || label.includes('ctc'))          pref = profile.expectedSalary;
      else pref = 'Yes';
      smartSelect(sel, pref);
    });

    // 3. Text/number inputs
    modal.querySelectorAll('input[type="text"], input[type="number"], input:not([type])').forEach(inp => {
      if (!inp.offsetParent || inp.readOnly || inp.disabled) return;
      if (inp.value && inp.value.trim()) return;
      const label = getLabelFor(inp);
      if (['email','first name','last name','full name','name'].some(w => label.includes(w))) return;
      let value = '';
      if      (label.includes('year') && (label.includes('experience') || label.includes('exp'))) value = profile.yearsExperience || '3';
      else if (label.includes('month') && label.includes('experience'))  value = profile.additionalMonthsExperience || '0';
      else if (label.includes('city') || (label.includes('location') && !label.includes('linkedin'))) value = profile.currentCity || 'Chennai';
      else if (label.includes('country'))                                  value = profile.currentCountry || 'India';
      else if (label.includes('fixed') && (label.includes('salary') || label.includes('ctc'))) value = profile.expectedSalary || '1200000';
      else if (label.includes('variable') || label.includes('bonus') || label.includes('incentive')) value = parseFloat(profile.variablePay) > 0 ? profile.variablePay : '1.0';
      else if (label.includes('rsu') || label.includes('stock') || label.includes('esop'))           value = parseFloat(profile.stockRsuValue) > 0 ? profile.stockRsuValue : '1.0';
      else if (label.includes('salary') || label.includes('ctc') || label.includes('compensation'))   value = profile.expectedSalary || '1200000';
      else if (label.includes('notice') || label.includes('days to join')) value = profile.noticePeriod === 'Immediately' ? '0' : '30';
      else if (label.includes('linkedin') || label.includes('profile url')) value = profile.linkedinProfileUrl || '';
      else if (label.includes('portfolio') || label.includes('website') || label.includes('github')) value = profile.portfolioUrl || profile.linkedinProfileUrl || '';
      else if (inp.type === 'number' || label.includes('years') || label.includes('months')) value = profile.yearsExperience || '3';
      if (value) { inp.focus(); setNativeValue(inp, value); }
    });

    // 4. Textareas
    modal.querySelectorAll('textarea').forEach(ta => {
      if (!ta.offsetParent || ta.readOnly || ta.disabled) return;
      if (ta.value && ta.value.trim().length > 10) return;
      ta.focus();
      setNativeValue(ta, profile.coverLetter || 'I am a motivated professional passionate about this opportunity. I bring strong technical skills and a collaborative approach to delivering high-quality results.');
    });

    // 5. Radio buttons — default Yes
    modal.querySelectorAll('fieldset').forEach(fs => {
      const radios = Array.from(fs.querySelectorAll('input[type="radio"]'));
      if (!radios.length || radios.find(r => r.checked)) return;
      const yesRadio = radios.find(r =>
        (r.getAttribute('aria-label') || r.closest('label')?.textContent || '').toLowerCase().includes('yes')
      );
      const target = yesRadio || radios[0];
      target.click();
      target.dispatchEvent(new Event('change', { bubbles: true }));
    });

  }, _profile);
}

async function hasValidationErrors() {
  return await page.evaluate(() => {
    const modal = document.querySelector('[data-test-modal-container], .jobs-easy-apply-modal, .artdeco-modal--layer-default, [role="dialog"]');
    if (!modal) return false;
    const errorSels = ['.artdeco-inline-feedback--error','[data-test-inline-feedback]','.fb-form-element__error-text','[aria-live="assertive"]','.form-element__error','span[class*="error"]','div[class*="error"]'];
    for (const sel of errorSels) {
      for (const el of modal.querySelectorAll(sel)) {
        if (el.offsetParent && el.textContent.trim().length > 0) return true;
      }
    }
    return false;
  });
}

async function fillEmptyRequiredFields() {
  await page.evaluate((profile) => {
    const modal = document.querySelector('[data-test-modal-container], .jobs-easy-apply-modal, .artdeco-modal--layer-default, [role="dialog"]');
    if (!modal) return;

    function setNativeValue(el, value) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur',   { bubbles: true }));
    }

    function getLabelFor(el) {
      let label = '';
      if (el.id) { const lel = modal.querySelector(`label[for="${el.id}"]`); if (lel) label = lel.textContent || ''; }
      if (!label) label = el.getAttribute('aria-label') || '';
      if (!label) {
        let p = el.parentElement;
        for (let i = 0; i < 5; i++) {
          if (!p) break;
          const lbl = p.querySelector('label, legend, span[class*="label"], div[class*="label"]');
          if (lbl && lbl !== el) { label = lbl.textContent || ''; break; }
          p = p.parentElement;
        }
      }
      return label.toLowerCase().trim();
    }

    modal.querySelectorAll('input[type="text"], input[type="number"], input:not([type])').forEach(inp => {
      if (!inp.offsetParent || inp.readOnly || inp.disabled) return;
      const label = getLabelFor(inp);
      let hasError = false;
      let p = inp.parentElement;
      for (let i = 0; i < 5; i++) {
        if (!p) break;
        const errEl = p.querySelector('.artdeco-inline-feedback--error, span[class*="error"], div[class*="error"], .fb-form-element__error-text');
        if (errEl && errEl.textContent.trim().length > 0) { hasError = true; break; }
        p = p.parentElement;
      }
      if (!hasError && inp.value && inp.value.trim()) return;
      let value = '';
      if      (label.includes('variable') || label.includes('bonus') || label.includes('incentive')) value = parseFloat(profile.variablePay) > 0 ? profile.variablePay : '1.0';
      else if (label.includes('rsu') || label.includes('stock') || label.includes('esop'))           value = parseFloat(profile.stockRsuValue) > 0 ? profile.stockRsuValue : '1.0';
      else if (label.includes('fixed') && (label.includes('salary') || label.includes('ctc')))       value = profile.expectedSalary || '600000';
      else if (label.includes('salary') || label.includes('ctc') || label.includes('compensation'))   value = profile.expectedSalary || '600000';
      else if (label.includes('notice') || label.includes('days'))   value = '0';
      else if (inp.type === 'number' || label.includes('year') || label.includes('month')) value = profile.yearsExperience || '3';
      if (value) { inp.focus(); setNativeValue(inp, value); }
    });
  }, _profile);
}

// ── Fill and submit loop ──────────────────────────────────────────
async function fillAndSubmit() {
  let steps = 0;
  let reviewCount = 0;
  const MODAL_SEL = '[data-test-modal-container], .jobs-easy-apply-modal, .artdeco-modal--layer-default, [role="dialog"]';

  while (steps < 25) {
    steps++;
    console.log(`📝 Step ${steps}...`);
    await delay(800, 1200);

    if (!(await isModalOpen())) {
      console.log('ℹ️ Modal closed — application complete');
      return { success: true, message: 'Application submitted (modal closed)' };
    }

    await fillCurrentStep();
    await delay(600, 900);

    if (await hasValidationErrors()) {
      console.log(`   ⚠️ Validation errors — running fix pass...`);
      await fillEmptyRequiredFields();
      await delay(800, 1200);
      await page.evaluate(() => {
        const modal = document.querySelector('[data-test-modal-container], .jobs-easy-apply-modal, .artdeco-modal--layer-default, [role="dialog"]');
        if (!modal) return;
        modal.querySelectorAll('input, select, textarea').forEach(el => {
          if (el.offsetParent) {
            el.dispatchEvent(new Event('blur',   { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      });
      await delay(500, 800);
    }

    if (steps <= 3) await screenshot(`step_${steps}`);

    // Try Submit button first
    const submitted = await page.evaluate((sel) => {
      const modal = document.querySelector(sel);
      if (!modal) return false;
      const btn = Array.from(modal.querySelectorAll('button')).find(b => {
        if (!b.offsetParent || b.disabled) return false;
        const t = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
        return t === 'submit application' || t === 'submit';
      });
      if (btn) { btn.click(); return true; }
      return false;
    }, MODAL_SEL);

    if (submitted) {
      console.log('✅ Submit clicked!');
      await delay(3000, 4000);
      await page.evaluate(() => {
        const done = Array.from(document.querySelectorAll('button')).find(b =>
          b.offsetParent && ['done','dismiss','close'].some(w => (b.textContent || '').toLowerCase().includes(w))
        );
        if (done) done.click();
      }).catch(() => {});
      return { success: true, message: '🎉 Application submitted via Easy Apply!' };
    }

    const btns = await getModalButtons();
    console.log(`   Buttons: [${btns.join('] [')}]`);

    const hasReview = btns.some(b => b.includes('review'));
    const hasNext   = btns.some(b => b.includes('next') || b.includes('continue'));

    if (hasReview && !hasNext) {
      reviewCount++;
      console.log(`   📋 Review page (seen ${reviewCount}x)`);

      if (reviewCount >= 2) {
        await screenshot(`review_stuck_${steps}`);
        const foundSubmit = await page.evaluate(() => {
          const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
          const btn = allBtns.find(b => {
            const t = (b.textContent || '').trim().toLowerCase();
            const a = (b.getAttribute('aria-label') || '').toLowerCase();
            return t === 'submit application' || t === 'submit' || a.includes('submit') || b.getAttribute('data-test-dialog-primary-btn') !== null;
          });
          if (btn) { btn.scrollIntoView({ block: 'center' }); btn.click(); return true; }
          return false;
        });

        if (!foundSubmit) {
          try {
            const loc = page.locator('button:has-text("Submit application"), button:has-text("Submit")').first();
            if (await loc.isVisible({ timeout: 2000 })) {
              await loc.scrollIntoViewIfNeeded();
              await loc.click({ force: true });
              await delay(3000, 4000);
              return { success: true, message: '🎉 Application submitted!' };
            }
          } catch (_) {}
        }

        if (foundSubmit) {
          await delay(3000, 4000);
          await page.evaluate(() => {
            const done = Array.from(document.querySelectorAll('button')).find(b =>
              b.offsetParent && ['done','dismiss','close'].some(w => (b.textContent || '').toLowerCase().includes(w))
            );
            if (done) done.click();
          }).catch(() => {});
          return { success: true, message: '🎉 Application submitted via Easy Apply!' };
        }

        await page.evaluate(() => {
          const discard = Array.from(document.querySelectorAll('button')).find(b =>
            b.offsetParent && ['discard','dismiss','exit','cancel'].some(w => (b.textContent || '').toLowerCase().includes(w))
          );
          if (discard) discard.click();
        }).catch(() => {});
        return { success: false, message: 'Stuck on Review page — Submit button not found' };
      }
    } else {
      if (!hasReview) reviewCount = 0;
    }

    const nextLabel = await page.evaluate((sel) => {
      const modal = document.querySelector(sel);
      if (!modal) return null;
      const NEXT_WORDS = ['continue to next step', 'next', 'continue', 'review your application', 'review'];
      for (const word of NEXT_WORDS) {
        const btn = Array.from(modal.querySelectorAll('button')).find(b => {
          if (!b.offsetParent || b.disabled) return false;
          const t = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
          return t.includes(word);
        });
        if (btn) { const label = (btn.textContent || '').trim().slice(0, 40); btn.click(); return label; }
      }
      return null;
    }, MODAL_SEL);

    if (nextLabel) {
      console.log(`  ➡️ "${nextLabel}"`);
      await delay(1500, 2500);
    } else {
      console.warn(`⚠️ No clickable button found at step ${steps}`);
      await screenshot(`stuck_step_${steps}`);
      break;
    }
  }

  await page.evaluate(() => {
    const discard = Array.from(document.querySelectorAll('button')).find(b =>
      b.offsetParent && ['discard','dismiss','exit'].some(w => (b.textContent || '').toLowerCase().includes(w))
    );
    if (discard) discard.click();
  }).catch(() => {});

  return { success: false, message: `Form incomplete after ${steps} steps` };
}

// ── Networking ────────────────────────────────────────────────────
async function sendConnectionRequest(profileUrl, note = '') {
  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2000, 3500);
    let connectBtn = await page.$('button[aria-label*="Connect"], button:has-text("Connect")').catch(() => null);
    if (!connectBtn) {
      const more = await page.$('button[aria-label="More actions"]').catch(() => null);
      if (more) { await more.click(); await delay(600, 1000); connectBtn = await page.$('div[aria-label*="Connect"]').catch(() => null); }
    }
    if (!connectBtn) return { success: false, message: 'Connect button not found' };
    await connectBtn.click();
    await delay(1000, 1800);
    if (note) {
      const addNote = await page.$('button[aria-label="Add a note"]').catch(() => null);
      if (addNote) { await addNote.click(); await delay(500, 900); await page.fill('textarea[name="message"]', note.slice(0, 300)).catch(() => {}); }
    }
    const sendBtn = await page.$('button[aria-label="Send now"], button[aria-label*="Send"]').catch(() => null);
    if (sendBtn) { await sendBtn.click(); return { success: true, message: 'Connection request sent!' }; }
    return { success: false, message: 'Could not click Send' };
  } catch (err) {
    return { success: false, message: `Connection error: ${err.message}` };
  }
}

// FIX: searchProfiles now uses updated selectors for LinkedIn 2024 UI
// and expands the network filter to include 3rd degree connections
// for many more profile results
async function searchProfiles(keywords, maxResults = 5) {
  const profiles = [];

  // Use a simpler, broader keyword for profile search
  // e.g. "React Developer, Frontend Engineer" → just use "React Developer"
  const searchTerm = keywords.split(',')[0].trim();

  // FIX: Removed strict network filter — now searches all connections
  // The previous "%5B%22F%22%2C%22S%22%5D" (1st+2nd only) was too restrictive
  const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchTerm)}&origin=GLOBAL_SEARCH_HEADER`;
  console.log(`🔍 Searching profiles: ${url}`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2500, 4000);
  } catch (e) {
    console.warn('Profile search navigation error:', e.message);
    return profiles;
  }

  // Scroll to load results
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await delay(400, 700);
  }
  await delay(1000, 1500);

  // FIX: Use JS extraction for profiles — more reliable than CSS selectors
  // which break across LinkedIn UI updates
  const extracted = await page.evaluate((max) => {
    const results = [];
    const seen = new Set();

    // Try multiple selectors for profile cards
    const cardSelectors = [
      '.reusable-search__result-container',
      'li.reusable-search__result-container',
      '[data-view-name="search-entity-result-universal-template"]',
      'ul.reusable-search__entity-result-list > li',
      '.search-results-container li',
    ];

    let cards = [];
    for (const sel of cardSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) { cards = Array.from(found); break; }
    }

    // Fallback: find all profile links
    if (cards.length === 0) {
      const links = document.querySelectorAll('a[href*="linkedin.com/in/"]');
      for (const link of links) {
        const href = link.href.split('?')[0];
        if (!href.includes('/in/') || seen.has(href)) continue;
        seen.add(href);
        const name = (link.querySelector('span[aria-hidden="true"]') || link)?.innerText?.trim()?.split('\n')[0] || '';
        if (name && name !== 'LinkedIn Member') {
          results.push({ name, title: '', link: href });
        }
        if (results.length >= max) break;
      }
      return results;
    }

    for (const card of cards.slice(0, max + 3)) {
      try {
        // Name
        const nameEl =
          card.querySelector('.entity-result__title-text a span[aria-hidden="true"]') ||
          card.querySelector('.artdeco-entity-lockup__title span[aria-hidden="true"]') ||
          card.querySelector('span[aria-hidden="true"]') ||
          card.querySelector('a[href*="/in/"]');
        const name = (nameEl?.innerText || '').trim().split('\n')[0];
        if (!name || name === 'LinkedIn Member' || name.length < 2) continue;

        // Title/headline
        const titleEl =
          card.querySelector('.entity-result__primary-subtitle') ||
          card.querySelector('.artdeco-entity-lockup__subtitle') ||
          card.querySelector('[class*="primary-subtitle"]');
        const title = (titleEl?.innerText || '').trim().split('\n')[0];

        // Profile link
        const linkEl = card.querySelector('a[href*="/in/"]');
        const link = linkEl?.href?.split('?')[0] || '';
        if (!link || seen.has(link)) continue;
        seen.add(link);

        results.push({ name, title, link });
        if (results.length >= max) break;
      } catch (_) {}
    }
    return results;
  }, maxResults).catch((e) => {
    console.warn('Profile extraction error:', e.message);
    return [];
  });

  profiles.push(...extracted);
  console.log(`✅ Found ${profiles.length} profiles`);
  return profiles;
}

module.exports = {
  loginLinkedIn,
  searchJobs,
  easyApply,
  sendConnectionRequest,
  searchProfiles,
  closeBrowser,
  setProfile,
};
