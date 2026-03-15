// ================================================================
//  backend/agents/pipeline.js  — v4.1 (Networking Mode Fixed)
//
//  Fixes vs v4.0:
//   ✅ When maxApps=0 (networking-only mode from Networking page),
//      Scout and Applier phases are COMPLETELY SKIPPED.
//      Goes straight to Login → Networker → Analyst.
//      This eliminates the 5-minute wait before connections start.
//   ✅ Applier applyLimit=0 guard — never enters apply loop when 0.
//   ✅ toApply fallback removed — if applyLimit is 0, nothing applies.
//   ✅ All v4.0 Firebase Admin writes preserved.
// ================================================================

const linkedin = require('./linkedin');
const { scoreJobMatch, generateConnectionNote } = require('./groq');
const { notifyPipelineComplete, notifyJobApplied, notifyConnectionSent } = require('./telegram');
const { incrementStats, saveJobs, saveApplication, saveConnection, logActivity } = require('../firebase/admin');
const axios = require('axios');

// ── SSE helper ────────────────────────────────────────────────────
function emit(res, phase, message, extra = {}) {
  console.log(`[${phase.toUpperCase()}] ${message}`);
  try {
    if (res && !res.writableEnded && !res.destroyed) {
      res.write(`data: ${JSON.stringify({ phase, message, ...extra })}\n\n`);
    }
  } catch (e) {
    console.warn('[SSE] write error (non-fatal):', e.message);
  }
}

const HARD_CAPS = { MAX_APPLICATIONS: 10, MAX_CONNECTIONS: 10 };
const N8N_WEBHOOK = process.env.N8N_WEBHOOK_URL || '';

async function pingN8n(event, payload) {
  if (!N8N_WEBHOOK) return;
  try {
    await axios.post(N8N_WEBHOOK, { event, ...payload }, { timeout: 8000 });
  } catch (e) {
    console.warn('[n8n] webhook failed (non-fatal):', e.message);
  }
}

const tg = async (token, chatId, fn, ...args) => {
  if (!token || !chatId) return;
  try { await fn(token, chatId, ...args); } catch (e) {
    console.warn('[Telegram] notify failed (non-fatal):', e.message);
  }
};

// ================================================================
//  MAIN PIPELINE
// ================================================================
async function runPipeline(params, res, isAborted) {
  const {
    goal, email, password, keywords, location,
    maxApps, maxConnections, minMatchScore,
    telegramToken, telegramChatId,
    userId,
    phone, yearsExperience, additionalMonthsExperience,
    englishProficiency, availableFullTime, canWorkCETHours,
    coverLetter, linkedinProfileUrl, portfolioUrl,
    expectedSalary, variablePay, stockRsuValue,
    noticePeriod, currentCity, currentCountry,
  } = params;

  if (!userId) {
    console.warn('[Pipeline] ⚠️  userId not provided — Firestore writes will be skipped!');
    emit(res, 'warning', '⚠️ userId missing — stats will not persist to database');
  }

  // FIX: Detect networking-only mode early
  const networkingOnly = Number(maxApps) === 0;
  if (networkingOnly) {
    console.log('[Pipeline] 🤝 Networking-only mode — Scout & Applier will be skipped');
  }

  const profile = {
    phone:                      phone                      || '',
    yearsExperience:            yearsExperience            || '3',
    additionalMonthsExperience: additionalMonthsExperience || '0',
    englishProficiency:         englishProficiency         || 'Professional',
    availableFullTime:          availableFullTime          || 'Yes',
    canWorkCETHours:            canWorkCETHours            || 'Yes',
    coverLetter:                coverLetter                || 'I am a motivated and experienced professional genuinely passionate about this role. I bring strong technical skills and a collaborative approach to delivering high-quality results.',
    linkedinProfileUrl:         linkedinProfileUrl         || '',
    portfolioUrl:               portfolioUrl               || '',
    expectedSalary:             expectedSalary             || '',
    variablePay:                variablePay                || '0.0',
    stockRsuValue:              stockRsuValue              || '0.0',
    noticePeriod:               noticePeriod               || 'Immediately',
    currentCity:                currentCity                || 'Chennai',
    currentCountry:             currentCountry             || 'India',
  };
  linkedin.setProfile(profile);

  const results = {
    jobsFound:   [],
    applied:     [],
    connections: [],
    insights:    [],
    errors:      [],
    status:      'running',
  };

  const written = { jobsFound: 0, applied: 0, connections: 0 };

  try {
    // ── 1. LOGIN ──────────────────────────────────────────────
    emit(res, 'login', '🔐 Logging into LinkedIn…');
    const loginResult = await linkedin.loginLinkedIn(email, password);

    if (!loginResult.success) {
      emit(res, 'error', `❌ Login failed: ${loginResult.message}`);
      emit(res, 'complete', '❌ Pipeline stopped at login', {
        results: { ...results, status: 'error' },
      });
      return results;
    }

    emit(res, 'login', '✅ Logged in successfully!');
    if (userId) await logActivity(userId, {
      type: 'login', icon: '🔐', color: 'rgba(0,200,255,0.1)',
      message: `Logged in as ${email}`,
    });

    // ── 2. SCOUT ─────────────────────────────────────────────
    // FIX: Skip Scout entirely when networking-only mode (maxApps=0)
    if (!networkingOnly) {
      const locationList = (location || 'India').split(',').map(l => l.trim()).filter(Boolean);
      emit(res, 'scout', `🔭 Searching: "${keywords}" in ${locationList.join(', ')}…`);

      let rawJobs = [];
      try {
        const seen = new Set();
        for (const loc of locationList) {
          emit(res, 'scout', `🔭 Scanning "${keywords}" in "${loc}"…`);
          const locJobs = await linkedin.searchJobs(keywords, loc, 20).catch(e => {
            console.warn(`searchJobs(${loc}) error:`, e.message);
            results.errors.push(`Scout/${loc}: ${e.message}`);
            return [];
          });
          for (const j of locJobs) {
            if (!seen.has(j.id)) { seen.add(j.id); rawJobs.push({ ...j, searchLocation: loc }); }
          }
          if (locationList.length > 1) await new Promise(r => setTimeout(r, 2000));
        }
      } catch (e) {
        console.error('[Scout] fatal:', e.message);
        results.errors.push('Scout failed: ' + e.message);
      }

      emit(res, 'scout', `🔭 ${rawJobs.length} jobs found — scoring with AI…`);

      const SCORE_BATCH = 5;
      for (let i = 0; i < rawJobs.length; i += SCORE_BATCH) {
        const batch = rawJobs.slice(i, i + SCORE_BATCH);
        await Promise.all(batch.map(async (job) => {
          try {
            const match = await scoreJobMatch(job.title, job.company, job.description || '', goal);
            job.score  = match.score;
            job.reason = match.reason;
          } catch (_) {
            job.score  = 70;
            job.reason = 'Good potential match';
          }
        }));
      }

      results.jobsFound = rawJobs.sort((a, b) => b.score - a.score);
      written.jobsFound = results.jobsFound.length;

      await saveJobs(userId, results.jobsFound.map(j => ({
        id: j.id, title: j.title, company: j.company,
        location: j.location, salary: j.salary,
        easyApply: j.easyApply, score: j.score, reason: j.reason, link: j.link,
      })));
      await incrementStats(userId, { jobsFound: written.jobsFound });

      emit(res, 'scout', `✅ Scout done — ${results.jobsFound.length} jobs scored`, {
        jobsCount: results.jobsFound.length,
        statsUpdate: { jobsFound: written.jobsFound },
        jobs: results.jobsFound.slice(0, 20).map(j => ({
          id: j.id, title: j.title, company: j.company, score: j.score, easyApply: j.easyApply,
        })),
      });

      if (userId) await logActivity(userId, {
        type: 'scout', icon: '🔭', color: 'rgba(0,200,255,0.12)',
        message: `Scout found ${results.jobsFound.length} jobs (top: ${results.jobsFound[0]?.title || 'N/A'})`,
      });
    } else {
      // Networking-only: emit a scout skip message so the frontend pipeline stepper advances
      emit(res, 'scout', '⏭️ Scout skipped — networking-only mode', {
        jobsCount: 0,
        statsUpdate: { jobsFound: 0 },
        jobs: [],
      });
    }

    // ── 3. APPLIER ────────────────────────────────────────────
    // FIX: Skip Applier entirely when maxApps=0
    const applyLimit = Math.min(Number(maxApps) || 0, HARD_CAPS.MAX_APPLICATIONS);

    if (!networkingOnly && applyLimit > 0) {
      emit(res, 'applier', '📝 Starting Applier…');

      const minScore = Number(minMatchScore) || 50;
      // FIX: No fallback — if limit is 0 or nothing matches, don't apply to anything
      const toApply = results.jobsFound.filter(j => j.score >= minScore).slice(0, applyLimit);

      if (toApply.length === 0) {
        emit(res, 'applier', `⚠️ No jobs met the minimum score of ${minScore}% — skipping applier`);
      } else {
        emit(res, 'applier', `📝 ${toApply.length} jobs queued (minScore: ${minScore}%, cap: ${applyLimit})`);

        for (const job of toApply) {
          emit(res, 'applier', `📝 Applying: ${job.title} @ ${job.company}…`);

          const applyResult = await linkedin.easyApply(job.link).catch(e => ({
            success: false, message: e.message,
          }));

          results.applied.push({ ...job, applyResult });

          const ok = applyResult?.success === true;
          emit(res, 'applier', `${ok ? '✅' : '⚠️'} ${job.title} @ ${job.company}: ${applyResult.message}`);

          if (ok) {
            written.applied++;
            await saveApplication(userId, {
              title:   job.title,
              company: job.company,
              score:   job.score,
              link:    job.link,
              status:  'applied',
              date:    new Date().toISOString().split('T')[0],
            });
            await incrementStats(userId, { applied: 1 });
            emit(res, 'applier_success', `✅ Applied: ${job.title} @ ${job.company}`, {
              statsUpdate: { applied: written.applied },
              application: { title: job.title, company: job.company, score: job.score, status: 'applied' },
            });
            await tg(telegramToken, telegramChatId, notifyJobApplied, job);
          }

          await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
        }
      }

      if (userId) await logActivity(userId, {
        type: 'applier', icon: '📝', color: 'rgba(0,230,118,0.12)',
        message: `Applied to ${written.applied} of ${toApply.length} jobs`,
      });
    } else if (!networkingOnly) {
      emit(res, 'applier', '⏭️ Applier skipped — maxApps is 0');
    } else {
      emit(res, 'applier', '⏭️ Applier skipped — networking-only mode');
    }

    // ── 4. NETWORKER ──────────────────────────────────────────
    emit(res, 'networker', '🤝 Finding professionals to connect with…');

    const connLimit = Math.min(Number(maxConnections) || 3, HARD_CAPS.MAX_CONNECTIONS);
    let profiles = [];
    try {
      profiles = await linkedin.searchProfiles(keywords, connLimit + 2);
    } catch (e) {
      console.error('[Networker] searchProfiles error:', e.message);
      results.errors.push('Networker: ' + e.message);
    }

    if (profiles.length === 0) {
      emit(res, 'networker', '⚠️ No profiles found this run — try different target roles');
    }

    for (const prof of profiles.slice(0, connLimit)) {
      emit(res, 'networker', `🤝 Connecting with ${prof.name}…`);

      let note = '';
      try { note = await generateConnectionNote(prof.name, prof.title, goal); }
      catch (_) { note = `Hi ${prof.name}, I'd love to connect and explore opportunities together!`; }

      const connResult = await linkedin.sendConnectionRequest(prof.link, note).catch(e => ({
        success: false, message: e.message,
      }));

      results.connections.push({ ...prof, note, result: connResult });

      const ok = connResult?.success === true;
      emit(res, 'networker', `${ok ? '✅' : '⚠️'} ${prof.name}: ${connResult.message}`);

      if (ok) {
        written.connections++;
        await saveConnection(userId, {
          name:  prof.name,
          title: prof.title,
          link:  prof.link,
          note,
        });
        await incrementStats(userId, { connections: 1 });
        emit(res, 'networker_success', `✅ Connection sent: ${prof.name}`, {
          statsUpdate: { connections: written.connections },
          connection: { name: prof.name, title: prof.title, status: 'pending' },
        });
        await tg(telegramToken, telegramChatId, notifyConnectionSent, prof);
      }

      await new Promise(r => setTimeout(r, 4000 + Math.random() * 3000));
    }

    if (userId) await logActivity(userId, {
      type: 'networker', icon: '🤝', color: 'rgba(123,63,255,0.12)',
      message: `Sent ${written.connections} connection requests`,
    });

    // ── 5. ANALYST ────────────────────────────────────────────
    emit(res, 'analyst', '📊 Generating insights…');

    const topJob  = results.jobsFound[0];
    const okApps  = results.applied.filter(a => a.applyResult?.success).length;
    const okConns = results.connections.filter(c => c.result?.success).length;

    results.insights = networkingOnly
      ? [
          `Networking-only run — ${okConns} connection requests sent`,
          `Profiles found: ${profiles.length}`,
          'Run the full Manager Agent pipeline to also apply to jobs',
        ]
      : [
          `Scanned ${results.jobsFound.length} jobs — top match: ${topJob?.title || 'N/A'} at ${topJob?.company || 'N/A'} (${topJob?.score || 0}%)`,
          `Applied to ${okApps} of ${results.applied.length} queued positions`,
          `Sent ${okConns} personalised connection requests`,
          `Best match reasoning: ${topJob?.reason || 'N/A'}`,
        ];

    if (userId) await logActivity(userId, {
      type: 'analyst', icon: '📊', color: 'rgba(255,184,0,0.12)',
      message: `Pipeline done — ${written.applied} applied, ${written.connections} connected`,
    });

    emit(res, 'analyst', '✅ Analyst complete', { insights: results.insights });

    // ── 6. COMPLETE ───────────────────────────────────────────
    results.status = results.errors.length > 0 ? 'warning' : 'success';

    const finalPayload = {
      status:   results.status,
      insights: results.insights,
      errors:   results.errors,
      statsUpdate: {
        jobsFound:   written.jobsFound,
        applied:     written.applied,
        connections: written.connections,
      },
      jobsFound: results.jobsFound.map(j => ({
        id: j.id, title: j.title, company: j.company,
        score: j.score, easyApply: j.easyApply, link: j.link,
      })),
      applied: results.applied.map(j => ({
        title: j.title, company: j.company, score: j.score,
        link: j.link, applyResult: j.applyResult,
      })),
      connections: results.connections.map(c => ({
        name: c.name, title: c.title, link: c.link, note: c.note, result: c.result,
      })),
    };

    emit(res, 'complete', '🎉 Pipeline complete!', { results: finalPayload });

    await tg(telegramToken, telegramChatId, notifyPipelineComplete, results);
    await pingN8n('pipeline_complete', { email, keywords, location, results: finalPayload });

  } catch (err) {
    console.error('[Pipeline] Fatal error:', err);
    results.errors.push(err.message);
    emit(res, 'error', `❌ ${err.message}`);
    emit(res, 'complete', '❌ Pipeline error', { results: { ...results, status: 'error' } });
  } finally {
    console.log('[Pipeline] Closing browser…');
    await linkedin.closeBrowser().catch(() => {});
    console.log('[Pipeline] Done.');
  }

  return results;
}

module.exports = { runPipeline };
