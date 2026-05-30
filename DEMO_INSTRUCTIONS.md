# Live Demo Instructions (5 Minutes)

These steps let you run a quick live demo on your machine and record it.

## 1) Backend options (2 minutes)

### Option A: Use the hosted demo backend (no API key needed)

Set the extension **Backend URL** to:

```
https://bogus-amicably-upper.ngrok-free.dev
```

Note: this link only works while the server + ngrok are running.

### Option B: Run locally (requires your own API key)

1. Create `backend/.env` with at least this:

```
ANTHROPIC_API_KEY=your_key_here
```

Optional (only needed for extra features):

```
GOOGLE_FACT_CHECK_API_KEY=optional
REDIS_URL=optional
DATABASE_URL=optional
CLOUDINARY_CLOUD_NAME=optional
CLOUDINARY_API_KEY=optional
CLOUDINARY_API_SECRET=optional
```

2. Start the backend:

```
cd backend
npm install
npm start
```

You should see: `Backend running -> http://localhost:3000`

## 2) Download and load the Chrome extension (1 minute)

1. Download the project zip and unzip it.
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the unzipped project root folder (the folder with `manifest.json`)
5. Open the extension popup and set **Backend URL** to the hosted link above (or `http://localhost:3000` if running locally), then click **Save**.

## 3) Demo flow (2 minutes)

1. Open any normal web page (not `chrome://` pages).
2. Highlight a short claim on the page.
3. Right click -> **Verify Claim**.
4. Wait for the floating result card to appear.
5. Right click an image -> **Verify Image**.
6. Click the extension icon to show recent history.

## 4) Troubleshooting (quick)

- **"Failed to connect to backend"**: ensure the backend is running (or the ngrok link is still live).
- **No menu items**: reload the extension from `chrome://extensions/`.
- **Internal pages blocked**: use a normal website (news/blog site).

## 5) If you must upload a zip

- Zip the project root folder.
- Include this file so reviewers can run the demo quickly.
