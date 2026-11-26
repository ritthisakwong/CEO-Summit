# AI handoff — THE FINAL CEO SUMMIT

This is the complete source for a Thai–English, red-and-white bachelorette party voting web app. Continue from this codebase. Read README.md for local setup and HTTPS deployment, then run npm ci and npm test with Node.js 24.

## User-facing behavior

- /vote: anonymous mobile ballot, ten required integer scores from 1 to 5, optional feedback, one submission per browser token per round. No names required.
- /projector: QR targets /vote on the configured PUBLIC_ORIGIN, shared live response count, sequential KPI reveals, then overall mean and approved feedback.
- /admin: password-protected controls to open or close voting, reveal the next KPI or overall result, approve or hide feedback, and reset the round. Reset removes votes and feedback and leaves voting closed.
- Preserve these KPI topics and their reveal order: punctuality, group chat response, confidentiality, shopping budget, restaurant decisions, crisis management, friendship, sending clips, girls’ trip planning, executive presence. Keep the copy playful and kind.

## Project map

- server.mjs: Node HTTP server, SQLite persistence, JSON API, Server-Sent Events, QR generation, participant cookies, and server-side admin authorization.
- public/index.html, app.js, style.css: shared shell, route-specific client UI, and responsive styling.
- flow.test.mjs: integration test using two distinct voter cookies, separate projector event stream, and authenticated admin requests.
- Dockerfile: single-instance deployment. Keep /data on persistent storage and use HTTPS for internet access. The reverse proxy should stream /api/events without buffering.
- README.md: operator instructions for a private Wi-Fi session or an HTTPS host.

## Verification and open work

The integration test previously passed, including duplicate submissions, hidden scores, ordered reveals, moderation, persistence after restart, and round reset. Browser layout and scanning on a physical phone still need verification. No production host, public URL, or production QR has been verified. The first deployment should be checked from a separate phone and network before sharing.

Configure your own random ADMIN_PASSWORD and PUBLIC_ORIGIN using the hosting provider's environment settings. No credentials, installed dependencies, or live voting data are included. Keep unrevealed scores and unapproved feedback out of every public API response. Treat any future user-provided feedback as plain text.
