// ================================================================
//  telegram.js — Send notifications via Telegram Bot API
//  Multi-strategy: proxy → alternative domain → direct
//  Handles ISP blocks on api.telegram.org
// ================================================================

const axios = require('axios');
const https = require('https');

const TIMEOUT_MS  = 20000;
const MAX_RETRIES = 2;

// Cloudflare Worker relay — bypasses ISP blocks on api.telegram.org
// This is the same worker used by the frontend
const CF_RELAY_URL = 'https://shiny-mountain-c7b9.charanvignesh358.workers.dev';

/**
 * Build axios config with optional proxy and TLS bypass
 */
function buildAxiosConfig(forceInsecure = false) {
  const config = {
    timeout: TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
  };

  // If HTTPS_PROXY is set in .env, route through it
  if (process.env.HTTPS_PROXY || process.env.https_proxy) {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
    try {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      config.httpsAgent = new HttpsProxyAgent(proxyUrl);
      console.log('🔀 Telegram using proxy:', proxyUrl);
    } catch (e) {
      console.warn('https-proxy-agent not installed, ignoring proxy');
    }
  } else if (forceInsecure) {
    // Fallback: bypass TLS verification (handles some ISP MITM setups)
    config.httpsAgent = new https.Agent({ rejectUnauthorized: false });
  }

  return config;
}

/**
 * Translate network errors into human-readable messages
 */
function friendlyError(err) {
  const code = err.code || '';
  if (code === 'ECONNRESET')   return 'Connection reset — api.telegram.org is blocked by your ISP. Set HTTPS_PROXY in backend/.env or use a VPN.';
  if (code === 'ECONNREFUSED') return 'Connection refused to api.telegram.org — check firewall settings';
  if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') return 'Connection timed out — api.telegram.org unreachable. Try a VPN.';
  if (code === 'ENOTFOUND')    return 'DNS lookup failed for api.telegram.org — check internet connection';
  if (err.response?.data?.description) return `Telegram API error: ${err.response.data.description}`;
  return err.message;
}

/**
 * Core send — tries multiple strategies to work around ISP blocks
 */
async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) throw new Error('Missing Telegram token or chatId');

  const payload = { chat_id: String(chatId), text, parse_mode: 'HTML' };
  let lastErr;

  // Strategy 1: Normal request (with optional proxy from .env)
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const url    = `https://api.telegram.org/bot${token}/sendMessage`;
      const config = buildAxiosConfig(false);
      const res    = await axios.post(url, payload, config);
      if (res.data?.ok) {
        console.log(`📨 Telegram sent (attempt ${attempt}):`, text.slice(0, 60));
        return res.data;
      }
      throw new Error(res.data?.description || 'Unknown Telegram API error');
    } catch (err) {
      lastErr = err;
      const netErr = ['ECONNRESET','ETIMEDOUT','ECONNABORTED','ENOTFOUND','ECONNREFUSED'].includes(err.code);
      if (netErr && attempt < MAX_RETRIES) {
        console.warn(`⚠️  Telegram attempt ${attempt} failed (${err.code}), retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      break;
    }
  }

  // Strategy 2: Cloudflare Worker relay (bypasses ISP blocks entirely)
  try {
    console.warn('🔄 Trying Cloudflare Worker relay for Telegram...');
    const res = await axios.post(
      CF_RELAY_URL,
      { token, chatId: String(chatId), text },
      { timeout: TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } }
    );
    if (res.data?.ok) {
      console.log('📨 Telegram sent via Cloudflare relay!');
      return res.data;
    }
  } catch (err2) {
    lastErr = err2;
    console.warn('CF relay also failed:', err2.code || err2.message);
  }

  // Strategy 3: TLS-bypass (last resort)
  try {
    console.warn('🔄 Trying TLS-bypass mode for Telegram...');
    const url    = `https://api.telegram.org/bot${token}/sendMessage`;
    const config = buildAxiosConfig(true);
    const res    = await axios.post(url, payload, config);
    if (res.data?.ok) {
      console.log('📨 Telegram sent via TLS-bypass!');
      return res.data;
    }
  } catch (err3) {
    lastErr = err3;
    console.warn('TLS-bypass also failed:', err3.code || err3.message);
  }

  throw new Error(friendlyError(lastErr));
}

/**
 * Test the bot
 */
async function testTelegramBot(token, chatId) {
  const msg = [
    `🤖 <b>LinkedAI Bot Connected!</b>`,
    ``,
    `✅ Your Telegram notifications are working.`,
    `You'll receive alerts when:`,
    `  • 📝 A job is applied to`,
    `  • 🤝 A connection request is sent`,
    `  • 🎉 The pipeline completes`,
    ``,
    `<i>${new Date().toLocaleString()}</i>`,
  ].join('\n');
  return sendTelegram(token, chatId, msg);
}

/**
 * Pipeline complete summary
 */
async function notifyPipelineComplete(token, chatId, results) {
  const applied     = (results.applied     || []).filter(a => a?.applyResult?.success).length;
  const connections = (results.connections || []).filter(c => c?.result?.success).length;
  const jobsFound   = (results.jobsFound   || []).length;
  const errors      = (results.errors      || []).length;
  const status      = results.status === 'success' ? '✅' : results.status === 'warning' ? '⚠️' : '❌';

  const msg = [
    `${status} <b>LinkedAI Pipeline Complete</b>`,
    ``,
    `🔭 <b>Jobs Found:</b> ${jobsFound}`,
    `📝 <b>Applied:</b> ${applied}`,
    `🤝 <b>Connections Sent:</b> ${connections}`,
    errors > 0 ? `⚠️ <b>Errors:</b> ${errors}` : '',
    ``,
    `<i>${new Date().toLocaleString()}</i>`,
  ].filter(Boolean).join('\n');

  return sendTelegram(token, chatId, msg);
}

/**
 * Single job application alert
 */
async function notifyJobApplied(token, chatId, job) {
  const msg = [
    `📝 <b>Applied to Job!</b>`,
    ``,
    `🏢 <b>Company:</b> ${job.company || 'N/A'}`,
    `💼 <b>Role:</b> ${job.title || 'N/A'}`,
    `🎯 <b>Match Score:</b> ${job.score || 0}%`,
    job.link ? `🔗 <a href="${job.link}">View Job</a>` : '',
  ].filter(Boolean).join('\n');
  return sendTelegram(token, chatId, msg);
}

/**
 * Connection request sent alert
 */
async function notifyConnectionSent(token, chatId, profile) {
  const msg = [
    `🤝 <b>Connection Request Sent!</b>`,
    ``,
    `👤 <b>Name:</b> ${profile.name || 'N/A'}`,
    `💼 <b>Title:</b> ${profile.title || 'N/A'}`,
  ].filter(Boolean).join('\n');
  return sendTelegram(token, chatId, msg);
}

module.exports = { sendTelegram, testTelegramBot, notifyPipelineComplete, notifyJobApplied, notifyConnectionSent };
