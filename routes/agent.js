// ================================================================
//  backend/routes/agent.js  — v4.0
//  SSE streaming pipeline endpoint.
//  Accepts userId from the frontend so the Admin SDK can write
//  stats / applications / connections to Firestore directly.
// ================================================================

const express      = require('express');
const router       = express.Router();
const { runPipeline } = require('../agents/pipeline');

router.post('/run', async (req, res) => {
  const {
    goal, email, password, keywords, location,
    maxApps, maxConnections, minMatchScore,
    telegramToken, telegramChatId,
    userId,                        // ← now required for Admin writes
    phone, yearsExperience, additionalMonthsExperience,
    englishProficiency, availableFullTime, canWorkCETHours,
    coverLetter, linkedinProfileUrl, portfolioUrl,
    expectedSalary, variablePay, stockRsuValue,
    noticePeriod, currentCity, currentCountry,
  } = req.body;

  console.log('\n📥 /api/agent/run');
  console.log('   email    :', email);
  console.log('   userId   :', userId || '⚠️  MISSING — Firestore writes will be skipped');
  console.log('   keywords :', keywords);
  console.log('   location :', location);
  console.log('   maxApps  :', maxApps, '| maxConns:', maxConnections, '| minScore:', minMatchScore);

  if (!email || !password) {
    return res.status(400).json({ error: 'LinkedIn credentials (email + password) are required.' });
  }
  if (!keywords) {
    return res.status(400).json({ error: 'Search keywords are required.' });
  }

  // ── SSE headers ─────────────────────────────────────────────────
  res.setHeader('Content-Type',                'text/event-stream');
  res.setHeader('Cache-Control',               'no-cache');
  res.setHeader('Connection',                  'keep-alive');
  res.setHeader('X-Accel-Buffering',           'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Immediate ping so the client knows the stream is open
  res.write(`data: ${JSON.stringify({ phase: 'ping', message: '🔌 Connected — starting pipeline…' })}\n\n`);

  // Keepalive heartbeat every 20 s (prevents proxy timeouts)
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': heartbeat\n\n');
  }, 20_000);

  const isAborted = () => res.destroyed || (req.socket?.destroyed && !res.writableEnded);

  try {
    await runPipeline(
      {
        goal, email, password, keywords, location,
        maxApps, maxConnections, minMatchScore,
        telegramToken, telegramChatId,
        userId,
        phone, yearsExperience, additionalMonthsExperience,
        englishProficiency, availableFullTime, canWorkCETHours,
        coverLetter, linkedinProfileUrl, portfolioUrl,
        expectedSalary, variablePay, stockRsuValue,
        noticePeriod, currentCity, currentCountry,
      },
      res,
      isAborted
    );
  } catch (err) {
    console.error('[agent.js] Unhandled pipeline error:', err.message);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ phase: 'error', message: `❌ ${err.message}` })}\n\n`);
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

router.get('/status', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

module.exports = router;
