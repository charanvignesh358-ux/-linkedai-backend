// ================================================================
//  routes/content.js — Real LinkedIn Content Studio API
//  Endpoints:
//    POST /api/content/sync     — Full data sync (posts, leads, comments)
//    POST /api/content/leads    — Fetch only leads
//    POST /api/content/post     — Publish a post to LinkedIn
//    POST /api/content/message  — Send a message to a lead
// ================================================================

const express = require('express');
const router  = express.Router();
const content = require('../agents/contentLinkedIn');
const axios   = require('axios');

// ── Helper: emit SSE ─────────────────────────────────────────────
function emit(res, phase, message, data = {}) {
  try {
    if (!res.writableEnded && !res.destroyed) {
      res.write(`data: ${JSON.stringify({ phase, message, ...data })}\n\n`);
    }
  } catch (_) {}
}

const N8N_CONTENT_WEBHOOK_URL = process.env.N8N_CONTENT_WEBHOOK_URL || '';

async function notifyN8nContent(event, payload) {
  if (!N8N_CONTENT_WEBHOOK_URL) return;
  try {
    await axios.post(
      N8N_CONTENT_WEBHOOK_URL,
      { event, ...payload },
      { timeout: 10000 }
    );
  } catch (e) {
    console.warn('n8n webhook (content) failed:', e.message);
  }
}

// ── POST /api/content/sync ───────────────────────────────────────
// Full sync: login → fetch posts + comments + leads + profile stats
router.post('/sync', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'LinkedIn credentials required. Add them in Settings.' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': heartbeat\n\n');
  }, 20000);

  try {
    // 1. Login
    emit(res, 'login', '🔐 Logging into LinkedIn...');
    const loginResult = await content.loginLinkedIn(email, password);
    if (!loginResult.success) {
      emit(res, 'error', `❌ ${loginResult.message}`);
      emit(res, 'complete', '❌ Sync stopped at login', { error: loginResult.message });
      return;
    }
    emit(res, 'login', '✅ Logged in successfully!');

    // 2. Profile stats
    emit(res, 'stats', '📊 Fetching your profile stats...');
    const profileStats = await content.fetchProfileStats();
    emit(res, 'stats', `✅ Profile stats fetched`, { profileStats });

    // 3. Posts
    emit(res, 'posts', '📝 Fetching your recent posts & engagement...');
    const posts = await content.fetchMyPosts(10);
    emit(res, 'posts', `✅ Found ${posts.length} recent posts`, { posts });

    // 4. Comments
    emit(res, 'comments', '💬 Fetching comments on your posts...');
    const comments = await content.fetchPostComments(15);
    emit(res, 'comments', `✅ Found ${comments.length} comments`, { comments });

    // 5. Leads
    emit(res, 'leads', '🎯 Fetching people who engaged with your content...');
    const leads = await content.fetchEngagedLeads(20);
    emit(res, 'leads', `✅ Found ${leads.length} leads`, { leads });

    // Complete
    const results = { profileStats, posts, comments, leads };
    emit(res, 'complete', '🎉 LinkedIn sync complete!', {
      results,
    });

    // Optional: trigger external n8n flow
    await notifyN8nContent('content_sync_complete', {
      email,
      results,
    });

  } catch (err) {
    console.error('Content sync error:', err);
    emit(res, 'error', `❌ Sync error: ${err.message}`);
    emit(res, 'complete', '❌ Sync failed', { error: err.message });
  } finally {
    clearInterval(heartbeat);
    await content.closeBrowser().catch(() => {});
    if (!res.writableEnded) res.end();
  }
});

// ── POST /api/content/leads ──────────────────────────────────────
// Refresh leads only (lighter — keeps session if open, else re-logins)
router.post('/leads', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'LinkedIn credentials required.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': heartbeat\n\n');
  }, 20000);

  try {
    emit(res, 'login', '🔐 Connecting to LinkedIn...');
    const loginResult = await content.loginLinkedIn(email, password);
    if (!loginResult.success) {
      emit(res, 'error', `❌ ${loginResult.message}`);
      emit(res, 'complete', '❌ Stopped', { error: loginResult.message });
      return;
    }
    emit(res, 'login', '✅ Connected!');
    emit(res, 'leads', '🎯 Scanning who engaged with your content...');
    const leads = await content.fetchEngagedLeads(20);
    emit(res, 'complete', `✅ Found ${leads.length} leads!`, { leads });
  } catch (err) {
    emit(res, 'error', `❌ ${err.message}`);
    emit(res, 'complete', '❌ Failed', { error: err.message });
  } finally {
    clearInterval(heartbeat);
    await content.closeBrowser().catch(() => {});
    if (!res.writableEnded) res.end();
  }
});

// ── POST /api/content/post ───────────────────────────────────────
// Publish a post to LinkedIn directly
router.post('/post', async (req, res) => {
  const { email, password, text } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'LinkedIn credentials required.' });
  if (!text)                return res.status(400).json({ error: 'Post text is required.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': heartbeat\n\n');
  }, 15000);

  try {
    emit(res, 'login', '🔐 Logging into LinkedIn...');
    const loginResult = await content.loginLinkedIn(email, password);
    if (!loginResult.success) {
      emit(res, 'error', `❌ ${loginResult.message}`);
      emit(res, 'complete', '❌ Stopped', { error: loginResult.message });
      return;
    }
    emit(res, 'posting', '📤 Publishing your post to LinkedIn...');
    const result = await content.postLinkedInUpdate(text);
    if (result.success) {
      emit(res, 'complete', `✅ ${result.message}`, { success: true });
    } else {
      emit(res, 'complete', `⚠️ ${result.message}`, { success: false, error: result.message });
    }
  } catch (err) {
    emit(res, 'error', `❌ ${err.message}`);
    emit(res, 'complete', '❌ Failed', { error: err.message });
  } finally {
    clearInterval(heartbeat);
    await content.closeBrowser().catch(() => {});
    if (!res.writableEnded) res.end();
  }
});

// ── POST /api/content/message ────────────────────────────────────
// Send a direct message to a lead
router.post('/message', async (req, res) => {
  const { email, password, profileUrl, message } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'LinkedIn credentials required.' });
  if (!profileUrl)          return res.status(400).json({ error: 'Profile URL required.' });
  if (!message)             return res.status(400).json({ error: 'Message text required.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': heartbeat\n\n');
  }, 15000);

  try {
    emit(res, 'login', '🔐 Connecting to LinkedIn...');
    const loginResult = await content.loginLinkedIn(email, password);
    if (!loginResult.success) {
      emit(res, 'error', `❌ ${loginResult.message}`);
      emit(res, 'complete', '❌ Stopped', { error: loginResult.message });
      return;
    }
    emit(res, 'messaging', `✉️ Sending message to lead...`);
    const result = await content.sendMessage(profileUrl, message);
    emit(res, 'complete', result.success ? `✅ ${result.message}` : `⚠️ ${result.message}`, {
      success: result.success,
    });
  } catch (err) {
    emit(res, 'error', `❌ ${err.message}`);
    emit(res, 'complete', '❌ Failed', { error: err.message });
  } finally {
    clearInterval(heartbeat);
    await content.closeBrowser().catch(() => {});
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
