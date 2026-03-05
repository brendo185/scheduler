# Scheduler

A modern scheduling dashboard with a calendar and event overview.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Build

```bash
npm run build
npm run preview
```

## Stack

- **React 19** + **TypeScript** + **Vite**
- **date-fns** for calendar and date logic
- CSS with custom properties (dark theme, Plus Jakarta Sans)

## Features

- **Dashboard** — Main view with calendar and side panels
- **Month calendar** — Navigate months, see event indicators per day, today highlighted
- **Today** — List of events for the current day
- **Upcoming** — Next few scheduled events
- **New event** — Button ready for future “add event” flow

- **Email to schedule** — Send an email to someone to schedule a meeting. Use the header button or the "Email" action on any event. The modal pre-fills subject and message; you can open it in your mail client ("Open in email") or, if the API is running, send from the app ("Send via app").

### Sending email from the app (optional)

To use "Send via app", run the API server and set a [Resend](https://resend.com) API key:

```bash
# In one terminal: start the API (default port 3001)
npm run server

# In another: start the frontend (proxies /api to the server)
npm run dev
```

Set environment variables (e.g. in a `.env` file in the project root; see `.env.example`):

- `RESEND_API_KEY` — Your Resend API key (get one at [resend.com/api-keys](https://resend.com/api-keys)).
- `FROM_EMAIL` (optional) — Sender address. Defaults to `Scheduler <onboarding@resend.dev>` (Resend’s test domain).

**If you get a 500 or “Failed to send”:** Check the terminal where `npm run server` is running; the server logs the real error from Resend. Common causes: invalid or missing `RESEND_API_KEY`; using a custom `FROM_EMAIL` whose domain isn’t verified in Resend (use the default or verify your domain at [resend.com/domains](https://resend.com/domains)).

Without the server or API key, use **Open in email** to compose in your default mail client.

Events are currently mock data; you can wire the same UI to your own API or state.
