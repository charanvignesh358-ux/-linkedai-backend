// ================================================================
//  groq.js — Groq AI helpers for scoring & message generation
// ================================================================

const axios = require('axios');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL    = 'llama-3.3-70b-versatile';

async function groqChat(systemPrompt, userMessage, maxTokens = 500) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not set in backend/.env');

  const res = await axios.post(
    GROQ_URL,
    {
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000, // 20s timeout — Groq is fast but set a ceiling
    }
  );

  return res.data.choices[0].message.content.trim();
}

// ── Score how well a job matches the user's goal ─────────────────
async function scoreJobMatch(jobTitle, jobCompany, jobDescription, userGoal) {
  const systemPrompt = `You are a career advisor. Score this job match from 0–100 and give a 1-sentence reason.
Return ONLY valid JSON with no markdown fences: {"score": <number>, "reason": "<string>"}`;

  const userMessage = `User goal: ${userGoal}
Job: ${jobTitle} at ${jobCompany}
Description: ${(jobDescription || 'Not available').slice(0, 400)}`;

  try {
    const raw     = await groqChat(systemPrompt, userMessage, 150);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(cleaned);
    // Validate shape
    if (typeof parsed.score !== 'number') throw new Error('bad shape');
    return parsed;
  } catch (err) {
    console.warn('scoreJobMatch fallback:', err.message);
    return { score: 70, reason: 'Good potential match' };
  }
}

// ── Generate a personalised connection note ───────────────────────
async function generateConnectionNote(profileName, profileTitle, userGoal) {
  const systemPrompt = `Write a short, genuine LinkedIn connection request note (max 200 characters).
No hashtags. No salesy language. Return ONLY the note text — nothing else.`;

  const userMessage = `Connecting with: ${profileName}${profileTitle ? ` (${profileTitle})` : ''}.
My goal: ${userGoal}`;

  try {
    const note = await groqChat(systemPrompt, userMessage, 80);
    // Trim to LinkedIn's 300-char limit just in case
    return note.slice(0, 300);
  } catch (err) {
    console.warn('generateConnectionNote fallback:', err.message);
    return `Hi ${profileName}, I'd love to connect and explore opportunities together!`;
  }
}

module.exports = { scoreJobMatch, generateConnectionNote };
