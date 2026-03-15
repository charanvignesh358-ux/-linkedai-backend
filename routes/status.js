const express = require('express');
const router  = express.Router();

// GET /api/status — Quick health check from frontend
router.get('/', (req, res) => {
  res.json({ online: true, version: '1.0.0', time: new Date().toISOString() });
});

module.exports = router;
