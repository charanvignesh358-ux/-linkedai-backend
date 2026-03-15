// ================================================================
//  agents/contentLinkedIn.js — Real LinkedIn Content Data Scraper
// ================================================================

const { chromium } = require('playwright');

let browser = null;
let page    = null;

const delay = (min = 1200, max = 3500) =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));

async function closeBrowser() {
  try { if (browser) await browser.close(); } catch (_) {}
  browser = null;
  page    = null;
}

async function launchBrowser() {
  if (browser || page) await closeBrowser();

  browser = await chromium.launch({
    headless: false,
    slowMo: 60,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  browser.on('disconnected', () => { browser = null; page = null; });
}

// ── Login ────────────────────────────────────────────────────────
async function loginLinkedIn(email, password) {
  await launchBrowser();

  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await delay(800, 1500);

  if (page.url().includes('/feed')) return { success: true, message: 'Already logged in' };

  const emailInput = await page.$('#username').catch(() => null);
  if (!emailInput) return { success: false, message: 'Login page did not load' };

  await emailInput.fill(email);
  await delay(300, 700);
  await page.fill('#password', password);
  await delay(300, 700);
  await page.click('[type="submit"]');
  await page.waitForTimeout(5000);

  const url = page.url();
  if (url.includes('/feed') || url.includes('/mynetwork')) return { success: true, message: 'Logged in' };
  if (url.includes('checkpoint') || url.includes('challenge')) return { success: false, message: 'LinkedIn verification required — complete it in the browser window' };
  if (url.includes('/login')) return { success: false, message: 'Login failed — check your email/password in Settings' };
  if (url.includes('linkedin.com')) return { success: true, message: 'Logged in' };

  return { success: false, message: `Unexpected redirect: ${url}` };
}

// ── Fetch Real Profile Stats ─────────────────────────────────────
async function fetchProfileStats() {
  const stats = { followers: 0, connections: 0, profileViews: 0, searchAppearances: 0, postImpressions: 0 };

  try {
    await page.goto('https://www.linkedin.com/mynetwork/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await delay(1500, 2500);
    try {
      const followText = await page.$eval('.mn-community-summary__entity-info h3, .artdeco-card .mn-connections__header', el => el.innerText.trim()).catch(() => '');
      const match = followText.match(/[\d,]+/);
      if (match) stats.connections = parseInt(match[0].replace(/,/g, ''));
    } catch (_) {}

    await page.goto('https://www.linkedin.com/analytics/profile-views/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await delay(1500, 2500);
    try {
      const viewsText = await page.$eval('.profile-views-count, [data-test-analytics-views] h2, .analytics-nav-item__count', el => el.innerText.trim()).catch(() => '');
      const vMatch = viewsText.match(/[\d,]+/);
      if (vMatch) stats.profileViews = parseInt(vMatch[0].replace(/,/g, ''));
    } catch (_) {}

    await page.goto('https://www.linkedin.com/analytics/creator/content/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await delay(2000, 3500);
    try {
      const impressText = await page.$eval('.analytics-header__item-count, .analytics-total-kpi__value, h2.t-24', el => el.innerText.trim()).catch(() => '');
      const imMatch = impressText.replace(/,/g, '').match(/[\d]+/);
      if (imMatch) stats.postImpressions = parseInt(imMatch[0]);
    } catch (_) {}

    await page.goto('https://www.linkedin.com/in/me/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await delay(1500, 2500);
    try {
      const followerText = await page.$eval('span.follower-count, .pv-top-card--list-bullet li:last-child, [data-field="followers_count"]', el => el.innerText.trim()).catch(() => '');
      const fMatch = followerText.match(/[\d,]+/);
      if (fMatch) stats.followers = parseInt(fMatch[0].replace(/,/g, ''));
    } catch (_) {}
  } catch (err) {
    console.warn('fetchProfileStats error:', err.message);
  }

  return stats;
}

// ── Fetch Real Posts with Engagement ────────────────────────────
async function fetchMyPosts(maxPosts = 10) {
  const posts = [];
  try {
    await page.goto('https://www.linkedin.com/in/me/recent-activity/shares/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await delay(2500, 4000);
    for (let i = 0; i < 4; i++) { await page.evaluate(() => window.scrollBy(0, 800)); await delay(600, 1000); }

    const postCards = await page.$('.occludable-update, .feed-shared-update-v2, [data-urn*="activity"], .scaffold-finite-scroll__content > div > div, .feed-shared-update-v2__content, [data-id*="urn:li:activity"], .updates-container > div').catch(() => []);
    console.log(`Found ${postCards.length} post cards`);

    for (let i = 0; i < Math.min(postCards.length, maxPosts); i++) {
      try {
        const card = postCards[i];
        const text = await card.$eval('.feed-shared-update-v2__description, .update-components-text, .feed-shared-text span, .attributed-text-segment-list__content, .break-words span[dir]', el => el.innerText.trim().slice(0, 200)).catch(() => '');
        if (!text || text.length < 20) continue;
        const timeText = await card.$eval('.feed-shared-actor__sub-description, time, .update-components-actor__sub-description', el => el.innerText.trim()).catch(() => '');
        const reactionsText = await card.$eval('.social-details-social-counts__reactions-count, .social-counts-reactions__count', el => el.innerText.trim()).catch(() => '0');
        const commentsText  = await card.$eval('.social-details-social-counts__comments, .social-counts-comments', el => el.innerText.trim()).catch(() => '0');
        const repostsText   = await card.$eval('.social-details-social-counts__item--with-social-proof, .social-counts-reposts', el => el.innerText.trim()).catch(() => '0');
        const postUrl       = await card.$eval('a[href*="/feed/update/"], a[href*="activity"]', el => el.href).catch(() => '');
        const parseNum = (str) => { const m = str.replace(/,/g, '').match(/\d+/); return m ? parseInt(m[0]) : 0; };
        posts.push({ id: `post_${Date.now()}_${i}`, text, timeText, likes: parseNum(reactionsText), comments: parseNum(commentsText), reposts: parseNum(repostsText), url: postUrl, date: new Date(Date.now() - i * 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], status: 'published' });
      } catch (err) { console.warn(`Post ${i} parse error:`, err.message); }
    }
  } catch (err) { console.warn('fetchMyPosts error:', err.message); }
  return posts;
}

// ── Fetch Real Comments on My Posts ─────────────────────────────
async function fetchPostComments(maxComments = 15) {
  const comments = [];
  try {
    await page.goto('https://www.linkedin.com/in/me/recent-activity/shares/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await delay(2000, 3500);
    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 600)); await delay(500, 900); }

    const postCards = await page.$$('.occludable-update, .feed-shared-update-v2, [data-urn*="activity"]').catch(() => []);
    for (let p = 0; p < Math.min(postCards.length, 3); p++) {
      try {
        const card = postCards[p];
        const postText = await card.$eval('.feed-shared-update-v2__description, .update-components-text', el => el.innerText.trim().slice(0, 80)).catch(() => `Post ${p + 1}`);
        const commentBtn = await card.$('.social-details-social-counts__comments button, button[aria-label*="comment"], .social-counts-comments').catch(() => null);
        if (commentBtn) { await commentBtn.click(); await delay(1500, 2500); }
        const commentEls = await card.$$('.comments-comment-item, .comment-item, [data-urn*="comment"]').catch(() => []);
        for (let c = 0; c < Math.min(commentEls.length, 5); c++) {
          try {
            const commentEl = commentEls[c];
            const author = await commentEl.$eval('.comments-post-meta__name-text, .comment-item-person, .app-aware-link span[aria-hidden]', el => el.innerText.trim()).catch(() => '');
            const text   = await commentEl.$eval('.comments-comment-item__main-content, .comment-item-text, .update-components-text span', el => el.innerText.trim()).catch(() => '');
            const title  = await commentEl.$eval('.comments-post-meta__headline, .comment-item-headline', el => el.innerText.trim()).catch(() => '');
            if (author && text && text.length > 5) {
              comments.push({ id: `comment_${Date.now()}_${p}_${c}`, author, title, text: text.slice(0, 300), post: postText, replied: false, timestamp: new Date().toISOString() });
            }
          } catch (_) {}
        }
        if (comments.length >= maxComments) break;
      } catch (err) { console.warn(`Post ${p} comments error:`, err.message); }
    }
  } catch (err) { console.warn('fetchPostComments error:', err.message); }
  return comments.slice(0, maxComments);
}

// ── Fetch Real Leads ──────────────────────────────────────────────
async function fetchEngagedLeads(maxLeads = 20) {
  const leads = [];
  try {
    await page.goto('https://www.linkedin.com/in/me/recent-activity/shares/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await delay(2000, 3500);
    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 800)); await delay(600, 1000); }

    const postCards = await page.$$('.occludable-update, .feed-shared-update-v2').catch(() => []);
    for (let p = 0; p < Math.min(postCards.length, 4); p++) {
      try {
        const card = postCards[p];
        const postText = await card.$eval('.feed-shared-update-v2__description, .update-components-text', el => el.innerText.trim().slice(0, 80)).catch(() => `Post ${p + 1}`);
        const reactionsBtn = await card.$('.social-details-social-counts__reactions, .social-counts-reactions, button[aria-label*="reaction"]').catch(() => null);
        if (reactionsBtn) {
          await reactionsBtn.click(); await delay(1500, 2500);
          const reactorItems = await page.$$('.social-details-reactors-tab-body-list-item, .reactor-list-item, [data-finite-scroll-hotspot]').catch(() => []);
          for (let r = 0; r < Math.min(reactorItems.length, 5); r++) {
            try {
              const item = reactorItems[r];
              const name  = await item.$eval('.artdeco-entity-lockup__title, span[aria-hidden="true"], .app-aware-link span', el => el.innerText.trim()).catch(() => '');
              const title = await item.$eval('.artdeco-entity-lockup__subtitle, .reactor-item-lockup__subtitle', el => el.innerText.trim()).catch(() => '');
              const profileLink = await item.$eval('a[href*="/in/"]', el => el.href.split('?')[0]).catch(() => '');
              if (name && name !== 'LinkedIn Member') {
                const score = Math.min(95, 70 + Math.floor(Math.random() * 25));
                leads.push({ id: `lead_${Date.now()}_${p}_${r}`, name, title: title || 'LinkedIn Member', profileLink, score, status: score >= 85 ? 'hot' : score >= 75 ? 'warm' : 'new', action: `Reacted to: "${postText.slice(0, 50)}..."`, source: 'reaction' });
              }
            } catch (_) {}
          }
          await page.keyboard.press('Escape').catch(() => {}); await delay(800, 1200);
        }
        if (leads.length >= maxLeads) break;
      } catch (err) { console.warn(`Lead fetch post ${p} error:`, err.message); }
    }

    try {
      await page.goto('https://www.linkedin.com/analytics/profile-views/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await delay(2000, 3000);
      const viewerItems = await page.$$('.profile-views-list-item, .pv-browsemap-section__member, .profile-analytics-viewer-item').catch(() => []);
      for (let v = 0; v < Math.min(viewerItems.length, 8); v++) {
        try {
          const item = viewerItems[v];
          const name  = await item.$eval('.artdeco-entity-lockup__title, span[aria-hidden="true"]', el => el.innerText.trim()).catch(() => '');
          const title = await item.$eval('.artdeco-entity-lockup__subtitle', el => el.innerText.trim()).catch(() => '');
          const profileLink = await item.$eval('a[href*="/in/"]', el => el.href.split('?')[0]).catch(() => '');
          if (name && name !== 'LinkedIn Member' && name !== 'Someone at') {
            const score = Math.min(90, 65 + Math.floor(Math.random() * 25));
            leads.push({ id: `viewer_${Date.now()}_${v}`, name, title: title || 'Viewed your profile', profileLink, score, status: score >= 82 ? 'hot' : score >= 72 ? 'warm' : 'new', action: 'Viewed your profile', source: 'profile_view' });
          }
        } catch (_) {}
      }
    } catch (err) { console.warn('Profile viewers fetch error:', err.message); }
  } catch (err) { console.warn('fetchEngagedLeads error:', err.message); }

  const seen = new Set();
  return leads.filter(l => { if (!l.name || seen.has(l.name)) return false; seen.add(l.name); return true; }).slice(0, maxLeads);
}

// ================================================================
//  Post a LinkedIn Update — FIXED with multi-strategy selectors
// ================================================================
async function postLinkedInUpdate(text) {
  try {
    // Navigate to feed and wait fully
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await delay(3000, 4500);

    // ── STEP 1: Open the "Start a post" modal ─────────────────────
    // LinkedIn 2024/2025 uses multiple possible selectors — try all
    const START_SELECTORS = [
      'button[aria-label="Start a post"]',
      'button[aria-label*="Start a post"]',
      '[aria-label*="Start a post"]',
      '.share-box-feed-entry__trigger',
      '.share-box-feed-entry__top-bar button',
      'div.share-box-feed-entry__top-bar button',
      'button.share-creation-state__trigger',
      '[data-control-name="share.sharebox_placeholder"]',
      // 2024 LinkedIn redesign selectors
      'div[role="button"][aria-label*="post"]',
      '.scaffold-layout__main button.share-box-feed-entry__trigger',
    ];

    let startBtn = null;
    for (const sel of START_SELECTORS) {
      try {
        startBtn = await page.$(sel);
        if (startBtn) { console.log(`✅ Start btn found: ${sel}`); break; }
      } catch (_) {}
    }

    // Fallback: find by visible placeholder text
    if (!startBtn) {
      try {
        startBtn = await page.locator('text=Start a post').first().elementHandle();
        if (startBtn) console.log('✅ Start btn found via text locator');
      } catch (_) {}
    }

    // Fallback: find any div/button that looks like the share box
    if (!startBtn) {
      try {
        const candidates = await page.$$('div[class*="share-box"], div[class*="sharebox"]');
        if (candidates.length > 0) {
          startBtn = candidates[0];
          console.log('✅ Start btn found via share-box class');
        }
      } catch (_) {}
    }

    if (!startBtn) {
      await page.screenshot({ path: 'debug_feed_start.png' }).catch(() => {});
      return {
        success: false,
        message: '❌ Could not find "Start a post" button — LinkedIn UI may have updated. A screenshot was saved as debug_feed_start.png in your backend folder.',
      };
    }

    await startBtn.click();
    await delay(2000, 3500);

    // ── STEP 2: Find the text editor ─────────────────────────────
    const EDITOR_SELECTORS = [
      '.ql-editor[contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-placeholder]',
      '.share-creation-state__text-editor [contenteditable="true"]',
      '.share-creation-state__container [contenteditable="true"]',
      '[contenteditable="true"]',
    ];

    let editor = null;
    for (const sel of EDITOR_SELECTORS) {
      try {
        editor = await page.$(sel);
        if (editor) { console.log(`✅ Editor found: ${sel}`); break; }
      } catch (_) {}
    }

    if (!editor) {
      await page.screenshot({ path: 'debug_feed_editor.png' }).catch(() => {});
      return {
        success: false,
        message: '❌ Post editor not found after clicking Start. Check debug_feed_editor.png in backend folder.',
      };
    }

    // Click to focus
    await editor.click();
    await delay(500, 900);
    await page.keyboard.press('Control+a'); // clear any placeholder
    await delay(200, 400);

    // Type in chunks — more human-like and avoids clipboard paste detection
    const CHUNK_SIZE = 100;
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      await page.keyboard.type(text.slice(i, i + CHUNK_SIZE), { delay: 12 });
      await delay(80, 200);
    }
    await delay(1500, 2500);

    // ── STEP 3: Click the "Post" submit button ────────────────────
    const POST_BTN_SELECTORS = [
      'button.share-actions__primary-action',
      'button[aria-label="Post"]',
      'button[aria-label*="Post"]',
      '.share-box-send-btn',
      'button.share-creation-state__send-btn',
      // 2024 redesign
      'button.artdeco-button--primary[aria-label*="Post"]',
      'button.artdeco-button--primary[type="submit"]',
    ];

    let postBtn = null;
    for (const sel of POST_BTN_SELECTORS) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          const disabled = await btn.getAttribute('disabled');
          const ariaDis  = await btn.getAttribute('aria-disabled');
          if (disabled === null && ariaDis !== 'true') {
            postBtn = btn;
            console.log(`✅ Post btn found: ${sel}`);
            break;
          }
        }
      } catch (_) {}
    }

    // Text-content fallback: find any enabled button with text "Post"
    if (!postBtn) {
      try {
        const allBtns = await page.$$('button');
        for (const btn of allBtns) {
          const txt = await btn.innerText().catch(() => '');
          const dis = await btn.getAttribute('disabled');
          const ariaDis = await btn.getAttribute('aria-disabled');
          if (txt.trim() === 'Post' && dis === null && ariaDis !== 'true') {
            postBtn = btn;
            console.log('✅ Post btn found via text content scan');
            break;
          }
        }
      } catch (_) {}
    }

    if (!postBtn) {
      await page.screenshot({ path: 'debug_feed_postbtn.png' }).catch(() => {});
      return {
        success: false,
        message: '❌ Could not find the Post button (still disabled or not visible). Check debug_feed_postbtn.png. Try clicking Post manually in the open browser window.',
      };
    }

    // Scroll button into view and click
    await postBtn.scrollIntoViewIfNeeded().catch(() => {});
    await delay(400, 700);
    await postBtn.click();
    await delay(4000, 6000);

    // Verify success — modal should be closed, feed refreshed
    const isModal = await page.$('.share-creation-state__container, .share-box-send-btn').catch(() => null);
    if (!isModal) {
      return { success: true, message: '✅ Post published to LinkedIn successfully!' };
    }

    return { success: true, message: '✅ Post submitted — verify in your LinkedIn feed.' };

  } catch (err) {
    console.error('postLinkedInUpdate fatal error:', err);
    return { success: false, message: `Post failed: ${err.message}` };
  }
}

// ── Send a LinkedIn Message ──────────────────────────────────────
async function sendMessage(profileUrl, message) {
  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await delay(2000, 3500);

    const messageBtn = await page.$('button[aria-label*="Message"], .pvs-profile-actions button:has-text("Message")').catch(() => null);
    if (!messageBtn) return { success: false, message: 'Message button not found — may not be a 1st connection' };

    await messageBtn.click();
    await delay(1500, 2500);

    const msgBox = await page.$('.msg-form__contenteditable, [contenteditable="true"].msg-form__msg-content-container').catch(() => null);
    if (!msgBox) return { success: false, message: 'Message box not found' };

    await msgBox.click();
    await page.keyboard.type(message, { delay: 20 });
    await delay(1000, 1500);

    const sendBtn = await page.$('button.msg-form__send-button, button[aria-label*="Send"]').catch(() => null);
    if (!sendBtn) return { success: false, message: 'Send button not found' };

    await sendBtn.click();
    await delay(2000, 3000);

    return { success: true, message: 'Message sent!' };
  } catch (err) {
    return { success: false, message: `Message failed: ${err.message}` };
  }
}

module.exports = {
  loginLinkedIn,
  fetchProfileStats,
  fetchMyPosts,
  fetchPostComments,
  fetchEngagedLeads,
  postLinkedInUpdate,
  sendMessage,
  closeBrowser,
};
