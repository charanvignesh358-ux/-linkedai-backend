// ================================================================
//  routes/chat.js — ChatBot endpoint (uses Groq, no CORS issues)
// ================================================================

const express  = require('express');
const router   = express.Router();
const axios    = require('axios');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL        = 'llama-3.3-70b-versatile';

router.post('/message', async (req, res) => {
  const { systemPrompt, messages } = req.body;

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY not set in backend/.env' });
  }
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  try {
    const response = await axios.post(
      GROQ_URL,
      {
        model:       MODEL,
        max_tokens:  1500,
        temperature: 0.6,
        messages: [
          { role: 'system', content: systemPrompt || 'You are a helpful AI assistant.' },
          ...messages,
        ],
      },
      {
        headers: {
          Authorization:  `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const reply = response.data.choices?.[0]?.message?.content?.trim() || '';
    res.json({ reply });

  } catch (err) {
    const status  = err.response?.status  || 500;
    const message = err.response?.data?.error?.message || err.message || 'Groq API error';
    console.error('[chat] Groq error:', status, message);
    res.status(status).json({ error: message });
  }
});

module.exports = router;
