# Vee Web Client

Web client for Vee (social voice-chat app). Voice-first: voice rooms via self-hosted LiveKit, 1-to-1 calls via P2P WebRTC — same backend as the native app (api-server + Firebase + LiveKit). Zero recurring cost; no ZEGOCLOUD anywhere.

## Quick start

```bash
cd ~/workspace/vee_app/final_src/artifacts/vee-web
npm install
cp .env.example .env   # set VITE_API_BASE_URL (default: http://207.180.253.22:3001)
npm run dev            # vite dev server
npm run build          # production build → dist/ (PWA)
```

## Env vars (client)

| Var | Purpose | Default |
|---|---|---|
| `VITE_API_BASE_URL` | api-server base URL | `http://207.180.253.22:3001` |
| `VITE_BKASH_NUMBER` | Our bKash number shown on the top-up page | (unset → page shows "not configured") |

## Server env vars (api-server, for crypto top-up)

| Var | Purpose |
|---|---|
| `USDT_TRC20_DEPOSIT_ADDRESS` | **Required.** Our USDT-TRC20 deposit address — the only address `topup-crypto` credits for |
| `USDT_DIAMOND_RATE` | Diamonds per 1 USDT (default `100`) — server-owned |
| `TRONSCAN_API_BASE` | Tronscan API base (default `https://api.tronscan.org`) |
| `TRONSCAN_API_BASE_FALLBACK` | Fallback Tronscan base (default `https://apilist.tronscan.org`) |

## Structure

- `src/features/voice-room/` — LiveKit voice rooms: seats, mute/host-mute, reconnect, gift feed + fly animation
- `src/features/calls/` — 1-to-1 WebRTC calls (same RTDB signaling as the native app)
- `src/features/chat/` — text chat (room + DMs per API contract)
- `src/features/wallet/` — balance, gift sending (server-owned prices), top-up page (bKash manual + USDT/TRC20)
- `src/lib/` — `firebase.ts`, `api.ts` (authed fetch helper), `mediaSession.ts` (background audio)

## Docs

- API contract: `~/workspace/vee_app/web-survey/API_CONTRACT.md`
- Top-up spec: `~/workspace/vee_app/web-survey/TOPUP_UPDATE.md`

## Not deployed

The api-server changes (`GET /api/wallet/topup-config`, `POST /api/wallet/topup-crypto`) are built locally only. Deploy `api-server/dist/index.mjs` to the VPS and set the env vars above before the top-up page can work end-to-end. The web `dist/` also needs hosting (same VPS).
