require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const app     = express();

// ── CORS — wide open for SSE streaming ───────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '10mb' }));

// ── Route Modules ─────────────────────────────────────────────────
const agentRoutes    = require('./routes/agent');
const statusRoutes   = require('./routes/status');
const contentRoutes  = require('./routes/content');
const telegramRoutes = require('./routes/telegram');
const chatRoutes     = require('./routes/chat');

app.use('/api/agent',    agentRoutes);
app.use('/api/status',   statusRoutes);
app.use('/api/content',  contentRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/chat',     chatRoutes);

// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── 404 handler ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ── Global error handler ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (!res.headersSent) res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`\n🚀 LinkedAI Backend running on http://localhost:${PORT}\n`));
