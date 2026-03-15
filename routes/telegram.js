// ================================================================
//  routes/telegram.js — Telegram notification endpoints
// ================================================================

const express = require('express');
const router  = express.Router();
const { testTelegramBot } = require('../agents/telegram');

// POST /api/telegram/test
router.post('/test', async (req, res) => {
  const { token, chatId } = req.body;

  if (!token || !chatId) {
    return res.status(400).json({ ok: false, error: 'token and chatId are required' });
  }

  // Basic token format check: should look like  123456789:AAF...
  if (!token.includes(':') || token.length < 20) {
    return res.status(400).json({ ok: false, error: 'Invalid token format — should be like 123456789:AAF...' });
  }

  try {
    await testTelegramBot(token, chatId.toString());
    res.json({ ok: true, message: '✅ Message sent! Check your Telegram.' });
  } catch (err) {
    console.error('Telegram test error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
