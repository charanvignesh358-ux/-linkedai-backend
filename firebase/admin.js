// ================================================================
//  backend/firebase/admin.js
//  Firebase Admin SDK — lets the pipeline write to Firestore
//  directly from Node, independent of the browser session.
//
//  Bootstrap priority:
//   1. FIREBASE_SERVICE_ACCOUNT_JSON env-var (CI / cloud)
//   2. serviceAccountKey.json on disk        (local dev)
//   3. Application Default Credentials       (GCP hosted)
// ================================================================

const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');

function initAdmin() {
  if (admin.apps.length > 0) return; // already initialised — skip

  // --- Priority 1: inline JSON env var
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
      console.log('🔥 Firebase Admin: initialised via env var');
      return;
    } catch (e) {
      console.error('❌ FIREBASE_SERVICE_ACCOUNT_JSON parse failed:', e.message);
    }
  }

  // --- Priority 2: serviceAccountKey.json file
  const keyPath = path.join(__dirname, 'serviceAccountKey.json');
  if (fs.existsSync(keyPath)) {
    try {
      const sa = require(keyPath);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
      console.log('🔥 Firebase Admin: initialised via serviceAccountKey.json');
      return;
    } catch (e) {
      console.error('❌ serviceAccountKey.json failed:', e.message);
    }
  }

  // --- Priority 3: Application Default Credentials
  try {
    admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'linkedin-6fea9' });
    console.log('🔥 Firebase Admin: initialised via Application Default Credentials');
  } catch (e) {
    console.error('❌ Firebase Admin ALL paths failed. Firestore writes will be skipped.', e.message);
  }
}

initAdmin();

const db         = admin.apps.length > 0 ? admin.firestore() : null;
const FieldValue = admin.apps.length > 0 ? admin.firestore.FieldValue : null;

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Atomically increment multiple stat fields for a user.
 * Creates the document with merge:true so it never overwrites existing data.
 */
async function incrementStats(userId, deltas = {}) {
  if (!db || !userId) return;
  const updates = { updatedAt: FieldValue.serverTimestamp() };
  let hasChanges = false;
  for (const [k, v] of Object.entries(deltas)) {
    if (typeof v === 'number' && v > 0) {
      updates[k] = FieldValue.increment(v);
      hasChanges = true;
    }
  }
  if (!hasChanges) return;
  try {
    await db.collection('stats').doc(userId).set(updates, { merge: true });
    console.log(`[FireAdmin] stats +`, deltas, '→ user:', userId);
  } catch (e) {
    console.warn('[FireAdmin] incrementStats failed (non-fatal):', e.message);
  }
}

/**
 * Save a batch of jobs found by the Scout agent.
 * Uses batch.set with merge so re-runs don't duplicate.
 */
async function saveJobs(userId, jobs = []) {
  if (!db || !userId || !jobs.length) return;
  try {
    const batch = db.batch();
    for (const job of jobs) {
      const docId = String(job.id || `job_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      const ref   = db.collection('jobs').doc(docId);
      // Strip undefined values so Firestore never rejects the write
      const safeJob = Object.fromEntries(
        Object.entries({ ...job, userId, updatedAt: FieldValue.serverTimestamp() })
          .map(([k, v]) => [k, v === undefined ? null : v])
      );
      batch.set(ref, safeJob, { merge: true });
    }
    await batch.commit();
    console.log(`[FireAdmin] ${jobs.length} jobs saved for ${userId}`);
  } catch (e) {
    console.warn('[FireAdmin] saveJobs failed (non-fatal):', e.message);
  }
}

/**
 * Save one application record to /applications.
 */
async function saveApplication(userId, app = {}) {
  if (!db || !userId) return;
  try {
    await db.collection('applications').add({
      ...app,
      userId,
      status:    app.status    || 'applied',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[FireAdmin] saveApplication failed (non-fatal):', e.message);
  }
}

/**
 * Save one connection record to /connections.
 */
async function saveConnection(userId, conn = {}) {
  if (!db || !userId) return;
  try {
    await db.collection('connections').add({
      ...conn,
      userId,
      status:    'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[FireAdmin] saveConnection failed (non-fatal):', e.message);
  }
}

/**
 * Append an event to the /activityFeed collection.
 */
async function logActivity(userId, event = {}) {
  if (!db || !userId) return;
  try {
    await db.collection('activityFeed').add({
      ...event,
      userId,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[FireAdmin] logActivity failed (non-fatal):', e.message);
  }
}

module.exports = { admin, db, FieldValue, incrementStats, saveJobs, saveApplication, saveConnection, logActivity };
