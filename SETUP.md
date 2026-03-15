# LinkedAI Backend — Setup Guide

## First Time Setup (do this once)

### Step 1 — Install backend dependencies
Open a terminal and run:
```
cd C:\Users\HP\OneDrive\Desktop\Production1\backend
npm install
```

### Step 2 — Install the Chromium browser (Playwright needs this)
```
npx playwright install chromium
```

### Step 3 — Add your LinkedIn credentials in the app
- Open the app → go to Settings
- Enter your LinkedIn Email and Password
- Save settings

---

## Every Time You Want to Run the Bot

### Terminal 1 — Start the backend
```
cd C:\Users\HP\OneDrive\Desktop\Production1\backend
npm start
```
You should see: 🚀 LinkedAI Backend running on http://localhost:4000

### Terminal 2 — Start the frontend (if not already running)
```
cd C:\Users\HP\OneDrive\Desktop\Production1
npm start
```

### Then in the app:
1. Go to Settings → enter LinkedIn credentials + keywords → Save
2. Go to Manager Agent → click Run Pipeline
3. Watch the live feed as it actually runs! 🎉

---

## What the pipeline does (REAL actions):
- 🔐 Logs into LinkedIn with your credentials
- 🔭 Searches for jobs matching your keywords
- 🤖 Scores each job with Groq AI (0-100 match score)
- 📝 Auto-applies to Easy Apply jobs with score ≥ 75
- 🤝 Finds and sends personalized connection requests
- 📊 Summarizes everything in the dashboard

## Tips:
- A browser window will open — this is normal! Playwright controls it
- Start with maxApps = 2-3 to test safely
- Use a secondary LinkedIn account for heavy automation
