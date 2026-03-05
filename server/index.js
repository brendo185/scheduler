import 'dotenv/config';
import express from 'express';
import { Resend } from 'resend';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

const app = express();
const port = Number(process.env.PORT) || 3001;
const resendApiKey = process.env.RESEND_API_KEY;
const fromEmailRaw = process.env.FROM_EMAIL || '';
const fromEmail = fromEmailRaw.trim() || 'Scheduler <onboarding@resend.dev>';
/** Base URL of the web app (e.g. https://yourapp.com or http://localhost:5173) for respond links in emails */
const baseUrl = process.env.BASE_URL || 'http://localhost:5173';

// Resend accepts "Name <email@domain.com>" or "email@domain.com"
function isValidFromEmail(value) {
  if (!value || typeof value !== 'string') return false;
  const s = value.trim();
  const simple = /^[^\s<]+@[^\s>]+$/;
  const withName = /^[^<]*<[^\s@]+@[^\s>]+>$/;
  return simple.test(s) || withName.test(s);
}

app.use(express.json());

const dataDir = path.join(process.cwd(), 'data');
const scheduleRequestsPath = path.join(dataDir, 'schedule-requests.json');
const calendarEventsPath = path.join(dataDir, 'calendar-events.json');
const contactsPath = path.join(dataDir, 'contacts.json');

// In-memory store for schedule requests; persisted to JSON file.
const scheduleRequests = new Map();
// In-memory list of calendar events coming from the dashboard
let calendarEvents = [];
// In-memory store for contacts created from client bookings; persisted to JSON file.
const contacts = new Map();

function loadScheduleRequestsFromFile() {
  try {
    const raw = fs.readFileSync(scheduleRequestsPath, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    scheduleRequests.clear();
    arr.forEach((r) => {
      if (r && r.id) scheduleRequests.set(r.id, r);
    });
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[schedule-requests] load error:', err.message);
  }
}

function saveScheduleRequestsToFile() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const arr = Array.from(scheduleRequests.values());
    fs.writeFileSync(scheduleRequestsPath, JSON.stringify(arr, null, 2), 'utf8');
  } catch (err) {
    console.error('[schedule-requests] save error:', err.message);
  }
}

function loadCalendarEventsFromFile() {
  try {
    const raw = fs.readFileSync(calendarEventsPath, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    calendarEvents = arr.filter(
      (e) =>
        e &&
        typeof e.id === 'string' &&
        typeof e.title === 'string' &&
        typeof e.start === 'string' &&
        typeof e.end === 'string',
    );
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[calendar-events] load error:', err.message);
  }
}

function saveCalendarEventsToFile() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(calendarEventsPath, JSON.stringify(calendarEvents, null, 2), 'utf8');
  } catch (err) {
    console.error('[calendar-events] save error:', err.message);
  }
}

function loadContactsFromFile() {
  try {
    const raw = fs.readFileSync(contactsPath, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    contacts.clear();
    arr.forEach((c) => {
      if (!c || typeof c.email !== 'string') return;
      const email = c.email.trim();
      if (!email) return;
      const key = email.toLowerCase();
      contacts.set(key, c);
    });
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[contacts] load error:', err.message);
  }
}

function saveContactsToFile() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const arr = Array.from(contacts.values());
    fs.writeFileSync(contactsPath, JSON.stringify(arr, null, 2), 'utf8');
  } catch (err) {
    console.error('[contacts] save error:', err.message);
  }
}

loadScheduleRequestsFromFile();
loadCalendarEventsFromFile();
loadContactsFromFile();

// Per-schedule-request lock so two clients cannot double-book the same slot (race prevention).
const respondLocks = new Map();

function sendJson(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).end(JSON.stringify(body));
}

app.get('/api/health', (req, res) => {
  sendJson(res, 200, { ok: true, resend: !!resendApiKey, version: 'slots-v2' });
});

// Hour slots 9 AM–5 PM (one-hour blocks): 09:00 … 16:00
const HOUR_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];
function isValidSlot(s) {
  return typeof s === 'string' && s.trim() && HOUR_SLOTS.includes(s.trim());
}

function normalizeResponses(req_) {
  const responses = req_.responses && Array.isArray(req_.responses) ? req_.responses : [];
  if (responses.length > 0) return responses;
  // Legacy: single response with selectedDates
  if (req_.response && Array.isArray(req_.response.selectedDates) && req_.response.selectedDates.length > 0) {
    return [{
      selectedDate: req_.response.selectedDates[0],
      selectedSlot: req_.response.selectedSlot || '09:00',
      respondentName: req_.response.respondentName,
      respondentEmail: req_.response.respondentEmail,
      respondentPhone: req_.response.respondentPhone,
      respondedAt: req_.response.respondedAt,
    }];
  }
  return [];
}

function takenSlotsFromResponses(responses) {
  const out = {};
  (responses || []).forEach((r) => {
    if (r.selectedDate && r.selectedSlot) {
      const d = String(r.selectedDate).slice(0, 10);
      if (!out[d]) out[d] = [];
      if (!out[d].includes(r.selectedSlot)) out[d].push(r.selectedSlot);
    }
  });
  return out;
}

function mergeTakenSlots(target, source) {
  Object.keys(source).forEach((date) => {
    if (!target[date]) target[date] = [];
    source[date].forEach((slot) => {
      if (!target[date].includes(slot)) target[date].push(slot);
    });
  });
  return target;
}

function takenSlotsFromCalendarEvents(events) {
  const out = {};
  (events || []).forEach((evt) => {
    if (!evt || !evt.start || !evt.end) return;
    const start = new Date(evt.start);
    const end = new Date(evt.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    const dateStr = start.toISOString().slice(0, 10);
    let hour = start.getHours();
    const endHour = end.getHours();
    while (hour < endHour) {
      const slot = `${String(hour).padStart(2, '0')}:00`;
      if (HOUR_SLOTS.includes(slot)) {
        if (!out[dateStr]) out[dateStr] = [];
        if (!out[dateStr].includes(slot)) out[dateStr].push(slot);
      }
      hour += 1;
    }
  });
  return out;
}

function allTakenSlots() {
  const out = {};
  // Include any events already on the main dashboard calendar
  const fromCalendar = takenSlotsFromCalendarEvents(calendarEvents);
  mergeTakenSlots(out, fromCalendar);
  // Then merge in any still-attached responses for legacy/edge cases.
  // Archived requests are excluded so that once a time is chosen and
  // added to the main calendar, the calendar becomes the single source
  // of truth for blocking time slots. This ensures that deleting a job
  // from the calendar will free up that time slot.
  scheduleRequests.forEach((req_) => {
    if (req_ && req_.archived) return;
    const responses = normalizeResponses(req_);
    const taken = takenSlotsFromResponses(responses);
    mergeTakenSlots(out, taken);
  });
  return out;
}

/**
 * When a client responds via a shared link or schedule email, immediately
 * reflect their chosen slot on the main calendar so the user's schedule
 * stays in sync without any extra clicks.
 */
function addCalendarEventForResponse(req_, responseEntry) {
  if (!req_ || !responseEntry) return;
  const dateStr = responseEntry.selectedDate;
  const startSlot = responseEntry.selectedSlot;
  if (!dateStr || !startSlot) return;

  // Build start/end Date objects based on the YYYY-MM-DD + HH:mm slot.
  const [startHRaw, startMRaw] = String(startSlot).split(':').map(Number);
  const startH = Number.isNaN(startHRaw) ? 9 : startHRaw;
  const startM = Number.isNaN(startMRaw) ? 0 : startMRaw;
  const endH = startH + 1;
  const endM = startM;

  const base = new Date(dateStr + 'T12:00:00');
  if (Number.isNaN(base.getTime())) return;

  const start = new Date(base);
  start.setHours(startH, startM, 0, 0);
  const end = new Date(base);
  end.setHours(endH, endM, 0, 0);

  const displayName =
    responseEntry.respondentName ||
    req_.recipientName ||
    req_.to ||
    null;
  const eventTitle = req_.eventTitle || req_.subject || 'Scheduled meeting';
  const titleWithName = displayName ? `${eventTitle} with ${displayName}` : eventTitle;

  const id = `request-${req_.id}-${dateStr}-${startSlot}`;
  // Avoid duplicating the same event id if it somehow already exists.
  const exists = calendarEvents.some((e) => e && e.id === id);
  if (exists) return;

  calendarEvents.push({
    id,
    title: titleWithName,
    start: start.toISOString(),
    end: end.toISOString(),
  });
  saveCalendarEventsToFile();
}

function addOrUpdateContactFromResponse(req_, responseEntry) {
  if (!responseEntry || !responseEntry.respondentEmail) return;
  const emailRaw = String(responseEntry.respondentEmail).trim();
  if (!emailRaw) return;
  const emailKey = emailRaw.toLowerCase();
  const nowIso = new Date().toISOString();

  const meeting = {
    requestId: req_.id,
    subject: req_.subject || null,
    eventTitle: req_.eventTitle || null,
    selectedDate: responseEntry.selectedDate || null,
    selectedSlot: responseEntry.selectedSlot || null,
    respondedAt: responseEntry.respondedAt || nowIso,
  };

  const existing = contacts.get(emailKey);
  if (existing) {
    const meetings = Array.isArray(existing.meetings) ? existing.meetings.slice() : [];
    meetings.push(meeting);
    existing.meetings = meetings;
    if (responseEntry.respondentName && !existing.name) {
      existing.name = responseEntry.respondentName;
    }
    if (responseEntry.respondentPhone && !existing.phone) {
      existing.phone = responseEntry.respondentPhone;
    }
    if (!existing.notes && responseEntry.respondentNotes) {
      existing.notes = responseEntry.respondentNotes;
    }
    if (responseEntry.respondentStreet && !existing.addressStreet) {
      existing.addressStreet = responseEntry.respondentStreet;
    }
    if (responseEntry.respondentAddress2 && !existing.addressLine2) {
      existing.addressLine2 = responseEntry.respondentAddress2;
    }
    if (responseEntry.respondentCity && !existing.addressCity) {
      existing.addressCity = responseEntry.respondentCity;
    }
    if (responseEntry.respondentState && !existing.addressState) {
      existing.addressState = responseEntry.respondentState;
    }
    if (responseEntry.respondentPostalCode && !existing.addressPostalCode) {
      existing.addressPostalCode = responseEntry.respondentPostalCode;
    }
    existing.lastMeetingAt = meeting.respondedAt;
    existing.updatedAt = nowIso;
    contacts.set(emailKey, existing);
  } else {
    contacts.set(emailKey, {
      id: randomUUID(),
      name: responseEntry.respondentName || null,
      email: emailRaw,
      phone: responseEntry.respondentPhone || null,
      notes: responseEntry.respondentNotes || null,
      addressStreet: responseEntry.respondentStreet || null,
      addressLine2: responseEntry.respondentAddress2 || null,
      addressCity: responseEntry.respondentCity || null,
      addressState: responseEntry.respondentState || null,
      addressPostalCode: responseEntry.respondentPostalCode || null,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastMeetingAt: meeting.respondedAt,
      meetings: [meeting],
    });
  }

  saveContactsToFile();
}

/** GET a single schedule request (for the respond page) */
app.get('/api/schedule-request/:id', (req, res) => {
  const id = req.params.id;
  const req_ = scheduleRequests.get(id);
  if (!req_) {
    return sendJson(res, 404, { message: 'Schedule request not found or expired.' });
  }
  const responses = normalizeResponses(req_);
  // Global taken slots across ALL schedule requests so two different
  // clients cannot book the same date + time, even from separate emails.
  const takenSlots = allTakenSlots();
  const hourSlots = Array.isArray(req_.hourSlots) && req_.hourSlots.length > 0 ? req_.hourSlots : HOUR_SLOTS;
  sendJson(res, 200, {
    id: req_.id,
    subject: req_.subject,
    proposedDates: req_.proposedDates || [],
    eventTitle: req_.eventTitle,
    responses,
    takenSlots,
    hourSlots,
  });
});

/** POST recipient's chosen date + time slot (one hour block 9–5). Also accepts legacy selectedDates array. */
app.post('/api/schedule-request/:id/respond', (req, res) => {
  const id = req.params.id;
  const prev = respondLocks.get(id) || Promise.resolve();
  let release;
  const ourTurn = new Promise((r) => { release = r; });
  respondLocks.set(id, prev.then(() => ourTurn));

  const run = () => {
    try {
      const req_ = scheduleRequests.get(id);
      if (!req_) {
        sendJson(res, 404, { message: 'Schedule request not found or expired.' });
        return;
      }
      let selectedDate = typeof req.body?.selectedDate === 'string' ? req.body.selectedDate.trim() : '';
      let selectedSlot = typeof req.body?.selectedSlot === 'string' ? req.body.selectedSlot.trim() : '';
      // Legacy: accept selectedDates array (use first date and default slot)
      if (!selectedDate && Array.isArray(req.body?.selectedDates) && req.body.selectedDates.length > 0) {
        const first = req.body.selectedDates.find((d) => typeof d === 'string' && d.trim());
        if (first) selectedDate = new Date(first.trim()).toISOString().slice(0, 10);
        if (!selectedSlot || !isValidSlot(selectedSlot)) selectedSlot = '09:00';
      }
      const dateNorm = selectedDate && selectedDate.match(/^\d{4}-\d{2}-\d{2}$/) ? selectedDate : null;
      if (!dateNorm) {
        sendJson(res, 400, { message: 'selectedDate is required (YYYY-MM-DD).' });
        return;
      }
      if (!isValidSlot(selectedSlot)) {
        sendJson(res, 400, { message: 'selectedSlot must be one of: ' + HOUR_SLOTS.join(', ') + '.' });
        return;
      }
      const proposedSet = new Set(req_.proposedDates || []);
      if (proposedSet.size > 0 && !proposedSet.has(dateNorm)) {
        sendJson(res, 400, { message: 'You can only choose from the dates offered.' });
        return;
      }
      const responses = normalizeResponses(req_);
      // Prevent double-booking across ALL schedule requests.
      const taken = allTakenSlots();
      if (taken[dateNorm] && taken[dateNorm].includes(selectedSlot)) {
        sendJson(res, 409, { message: 'That time slot is already taken. Please choose another date or time.' });
        return;
      }
      const respondentName = typeof req.body?.respondentName === 'string' ? req.body.respondentName.trim() : null;
      const respondentEmail = typeof req.body?.respondentEmail === 'string' ? req.body.respondentEmail.trim() : null;
      const respondentPhone = typeof req.body?.respondentPhone === 'string' ? req.body.respondentPhone.trim() : null;
      const respondentNotes = typeof req.body?.respondentNotes === 'string' ? req.body.respondentNotes.trim() : null;
      const respondentStreet = typeof req.body?.respondentStreet === 'string' ? req.body.respondentStreet.trim() : null;
      const respondentAddress2 = typeof req.body?.respondentAddress2 === 'string' ? req.body.respondentAddress2.trim() : null;
      const respondentCity = typeof req.body?.respondentCity === 'string' ? req.body.respondentCity.trim() : null;
      const respondentState = typeof req.body?.respondentState === 'string' ? req.body.respondentState.trim() : null;
      const respondentPostalCode = typeof req.body?.respondentPostalCode === 'string' ? req.body.respondentPostalCode.trim() : null;
      const entry = {
        selectedDate: dateNorm,
        selectedSlot,
        respondentName: respondentName || undefined,
        respondentEmail: respondentEmail || undefined,
        respondentPhone: respondentPhone || undefined,
        respondentNotes: respondentNotes || undefined,
        respondentStreet: respondentStreet || undefined,
        respondentAddress2: respondentAddress2 || undefined,
        respondentCity: respondentCity || undefined,
        respondentState: respondentState || undefined,
        respondentPostalCode: respondentPostalCode || undefined,
        respondedAt: new Date().toISOString(),
      };
      if (!req_.responses) {
        req_.responses = [];
        if (req_.response) {
          const legacy = req_.response;
          if (Array.isArray(legacy.selectedDates) && legacy.selectedDates.length > 0) {
            req_.responses.push({
              selectedDate: legacy.selectedDates[0],
              selectedSlot: legacy.selectedSlot || '09:00',
              respondentName: legacy.respondentName,
              respondentEmail: legacy.respondentEmail,
              respondentPhone: legacy.respondentPhone,
              respondentNotes: legacy.respondentNotes,
              respondedAt: legacy.respondedAt || new Date().toISOString(),
            });
          }
          delete req_.response;
        }
      }
      // Re-check taken immediately before adding (in case of any race)
      const takenNow = allTakenSlots();
      if (takenNow[dateNorm] && takenNow[dateNorm].includes(selectedSlot)) {
        sendJson(res, 409, { message: 'That time slot is already taken. Please choose another date or time.' });
        return;
      }
      req_.responses.push(entry);
      try {
        addOrUpdateContactFromResponse(req_, entry);
      } catch (err) {
        console.error(
          '[contacts] failed to upsert contact from response:',
          err && err.message ? err.message : err,
        );
      }
      try {
        addCalendarEventForResponse(req_, entry);
      } catch (err) {
        console.error('[schedule-requests] failed to add calendar event from response:', err && err.message ? err.message : err);
      }
      saveScheduleRequestsToFile();
      sendJson(res, 200, { ok: true, selectedDate: dateNorm, selectedSlot });
    } finally {
      release();
    }
  };

  prev.then(run).catch((err) => {
    release();
    if (!res.headersSent) sendJson(res, 500, { message: err?.message || 'Internal server error' });
  });
});

/** PATCH remove one response from a request (e.g. after adding to calendar) */
app.patch('/api/schedule-request/:id', (req, res) => {
  const id = req.params.id;
  const req_ = scheduleRequests.get(id);
  if (!req_) {
    return sendJson(res, 404, { message: 'Schedule request not found or already deleted.' });
  }
  const body = req.body || {};

  // New behavior: allow archiving an entire schedule request so it no longer
  // appears in the dashboard "Schedule replies" list once a time has been
  // chosen and added to the calendar.
  if (body.archive === true) {
    req_.archived = true;
    saveScheduleRequestsToFile();
    return sendJson(res, 200, { ok: true, archived: true });
  }

  const remove = body.removeResponse;
  if (!remove || typeof remove.selectedDate !== 'string' || typeof remove.selectedSlot !== 'string') {
    return sendJson(res, 400, { message: 'removeResponse: { selectedDate, selectedSlot } required when not archiving.' });
  }
  const dateStr = remove.selectedDate.trim().slice(0, 10);
  const slot = remove.selectedSlot.trim();
  if (!req_.responses || !Array.isArray(req_.responses)) {
    req_.responses = normalizeResponses(req_);
    if (req_.response) delete req_.response;
  }
  req_.responses = req_.responses.filter((r) => r.selectedDate !== dateStr || r.selectedSlot !== slot);
  saveScheduleRequestsToFile();
  sendJson(res, 200, { ok: true });
});

/** DELETE a schedule request (removes it from the list) */
app.delete('/api/schedule-request/:id', (req, res) => {
  const id = req.params.id;
  if (!scheduleRequests.has(id)) {
    return sendJson(res, 404, { message: 'Schedule request not found or already deleted.' });
  }
  scheduleRequests.delete(id);
  saveScheduleRequestsToFile();
  sendJson(res, 200, { ok: true });
});

/** GET all schedule requests (for dashboard: show pending and responses) */
app.get('/api/schedule-requests', (req, res) => {
  const list = Array.from(scheduleRequests.values())
    // Only show non-archived requests in the dashboard "Schedule replies" card.
    .filter((r) => !r.archived)
    .map((r) => ({
      id: r.id,
      to: r.to,
      recipientName: r.recipientName ?? null,
      subject: r.subject,
      proposedDates: r.proposedDates || [],
      eventTitle: r.eventTitle,
      createdAt: r.createdAt,
      responses: normalizeResponses(r),
      hourSlots: Array.isArray(r.hourSlots) && r.hourSlots.length > 0 ? r.hourSlots : undefined,
    }));
  sendJson(res, 200, { requests: list });
});

/** GET all calendar events (for debugging/inspection) */
app.get('/api/calendar-events', (req, res) => {
  sendJson(res, 200, { events: calendarEvents });
});

/** GET all contacts created from client bookings */
app.get('/api/contacts', (req, res) => {
  const list = Array.from(contacts.values());
  sendJson(res, 200, { contacts: list });
});

/** POST full sync of calendar events from dashboard (source of truth is the dashboard/local UI) */
app.post('/api/calendar-events/sync', (req, res) => {
  const incoming = Array.isArray(req.body?.events) ? req.body.events : [];
  const next = incoming
    .map((e) => {
      if (!e || typeof e.id !== 'string' || typeof e.title !== 'string' || typeof e.start !== 'string' || typeof e.end !== 'string') {
        return null;
      }
      const start = new Date(e.start);
      const end = new Date(e.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
      return {
        id: e.id,
        title: e.title,
        start: start.toISOString(),
        end: end.toISOString(),
      };
    })
    .filter(Boolean);
  calendarEvents = next;
  saveCalendarEventsToFile();
  sendJson(res, 200, { ok: true, count: calendarEvents.length });
});

app.post('/api/send-schedule-email', async (req, res) => {
  const sendError = (status, message) => {
    console.error('[send-schedule-email]', status, message);
    sendJson(res, status, { message: String(message) });
  };

  try {
    if (!resendApiKey) {
      return sendError(503, 'Email sending is not configured. Set RESEND_API_KEY in .env or environment, or use "Open in email".');
    }
    if (!isValidFromEmail(fromEmail)) {
      return sendError(400, 'Invalid FROM_EMAIL in .env. Use "Name <you@domain.com>" or "you@domain.com", and verify the domain at resend.com/domains.');
    }

    const { to, subject, body, proposedDates, eventTitle, recipientName } = req.body ?? {};
    if (!to || typeof to !== 'string' || !to.trim()) {
      return sendError(400, 'Recipient email (to) is required.');
    }

    // Support multiple recipients separated by commas or semicolons.
    const normalizeEmails = (value) =>
      typeof value === 'string'
        ? value
            .split(/[;,]+/)
            .map((part) => part.trim())
            .filter(Boolean)
        : [];
    const toList = normalizeEmails(to);
    if (toList.length === 0) {
      return sendError(400, 'At least one valid recipient email is required.');
    }

    const resend = new Resend(resendApiKey);
    let text = typeof body === 'string' ? body : '';
    const subj = typeof subject === 'string' && subject.trim() ? subject.trim() : "Let's schedule a time to meet";

    const requestId = randomUUID();
    const proposedDatesList = Array.isArray(proposedDates)
      ? proposedDates
          .filter((d) => typeof d === 'string' && d.trim())
          .map((d) => new Date(d.trim()).toISOString().slice(0, 10))
          .filter((d) => d && d.match(/^\d{4}-\d{2}-\d{2}$/))
      : [];
    const basePath = `${baseUrl.replace(/\/$/, '')}/respond/${requestId}`;
    const respondUrl = proposedDatesList.length > 0
      ? `${basePath}?dates=${encodeURIComponent(proposedDatesList.join(','))}`
      : basePath;
    const recipientNameStr = typeof recipientName === 'string' && recipientName.trim() ? recipientName.trim() : null;
    scheduleRequests.set(requestId, {
      id: requestId,
      to: toList.join(', '),
      recipientName: recipientNameStr || undefined,
      subject: subj,
      proposedDates: proposedDatesList,
      eventTitle: typeof eventTitle === 'string' ? eventTitle : null,
      createdAt: new Date().toISOString(),
      responses: [],
    });
    saveScheduleRequestsToFile();

    // Plain-text fallback: one line (HTML version shows the button only).
    text += `\n\nChoose your time slot (9 AM – 5 PM): ${respondUrl}`;

    // Build HTML so the recipient gets a visible clickable button/link (plain text links can be hidden or not clickable).
    const escapeHtml = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const bodyHtml = escapeHtml(text).replace(/\n/g, '<br>\n');
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #333; max-width: 560px;">
  <div style="margin-bottom: 24px;">${bodyHtml}</div>
  <p style="margin: 24px 0 0 0;">
    <a href="${escapeHtml(respondUrl)}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Choose your time slot</a>
  </p>
</body>
</html>`;

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: toList,
      subject: subj,
      text: text || 'No message body.',
      html: html.trim(),
    });

    if (error) {
      scheduleRequests.delete(requestId);
      saveScheduleRequestsToFile();
      const msg = error.message || (typeof error === 'string' ? error : 'Resend rejected the email.');
      console.error('[send-schedule-email] Resend error:', error);
      return sendError(400, msg);
    }
    sendJson(res, 200, { id: data?.id, ok: true, requestId, respondUrl });
  } catch (err) {
    const raw =
      (err && err.message) ||
      (err && typeof err === 'object' && 'message' in err ? String(err.message) : '') ||
      (err != null ? String(err) : '');
    const msg = (typeof raw === 'string' && raw.trim())
      ? raw.trim()
      : 'Email send failed. Check RESEND_API_KEY and FROM_EMAIL in .env, or use "Open in email".';
    console.error('[send-schedule-email] Exception:', err);
    sendError(500, msg);
  }
});

/**
 * Create a reusable event link (Calendly-style).
 *
 * This does NOT send any email. It simply creates a schedule request with:
 * - allowed dates
 * - optional custom hour slots (subset of 9 AM–5 PM)
 * - optional event title/subject
 *
 * The response includes a `respondUrl` that you can copy and share or
 * use in your own email blast. Multiple clients can visit the same link
 * and each choose an available time.
 */
app.post('/api/event-link', (req, res) => {
  const body = req.body || {};
  const rawSubject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const rawEventTitle = typeof body.eventTitle === 'string' ? body.eventTitle.trim() : '';
  const subj = rawSubject || rawEventTitle || "Let's schedule a time to meet";

  const proposedDatesList = Array.isArray(body.proposedDates)
    ? body.proposedDates
        .filter((d) => typeof d === 'string' && d.trim())
        .map((d) => new Date(d.trim()).toISOString().slice(0, 10))
        .filter((d) => d && d.match(/^\d{4}-\d{2}-\d{2}$/))
    : [];

  if (proposedDatesList.length === 0) {
    return sendJson(res, 400, { message: 'At least one allowed date is required.' });
  }

  // Optional start/end hour window within our canonical 9–5 slots.
  const startHour =
    typeof body.startHour === 'string' && body.startHour.match(/^\d{2}:\d{2}$/)
      ? body.startHour
      : '09:00';
  const endHour =
    typeof body.endHour === 'string' && body.endHour.match(/^\d{2}:\d{2}$/)
      ? body.endHour
      : '17:00';

  const hourSlots = HOUR_SLOTS.filter((slot) => slot >= startHour && slot < endHour);
  if (hourSlots.length === 0) {
    return sendJson(res, 400, { message: 'Time frame must include at least one one-hour slot between 9 AM and 5 PM.' });
  }

  const requestId = randomUUID();
  const basePath = `${baseUrl.replace(/\/$/, '')}/respond/${requestId}`;
  const respondUrl = `${basePath}`;

  scheduleRequests.set(requestId, {
    id: requestId,
    // No specific recipient; this is a shared link.
    to: '',
    recipientName: undefined,
    subject: subj,
    proposedDates: proposedDatesList,
    eventTitle: rawEventTitle || null,
    createdAt: new Date().toISOString(),
    responses: [],
    hourSlots,
  });
  saveScheduleRequestsToFile();

  sendJson(res, 200, { ok: true, requestId, respondUrl, hourSlots, proposedDates: proposedDatesList });
});

/** POST send confirmation email to client when a date/time has been chosen */
app.post('/api/send-confirmation-email', async (req, res) => {
  const sendError = (status, message) => {
    console.error('[send-confirmation-email]', status, message);
    sendJson(res, status, { message: String(message) });
  };

  try {
    if (!resendApiKey) {
      return sendError(503, 'Email sending is not configured. Set RESEND_API_KEY in .env to notify clients.');
    }
    if (!isValidFromEmail(fromEmail)) {
      return sendError(400, 'Invalid FROM_EMAIL in .env. Use "Name <you@domain.com>" or "you@domain.com", and verify the domain at resend.com/domains.');
    }

    const { to, clientName, dateStr, startTime, endTime, eventTitle, subject } = req.body ?? {};
    if (!to || typeof to !== 'string' || !to.trim()) {
      return sendError(400, 'Recipient email (to) is required.');
    }
    if (!dateStr || typeof dateStr !== 'string' || !dateStr.trim()) {
      return sendError(400, 'Date (dateStr) is required.');
    }

    const dateObj = new Date(dateStr.trim() + 'T12:00:00');
    if (Number.isNaN(dateObj.getTime())) {
      return sendError(400, 'Invalid date format. Use YYYY-MM-DD.');
    }

    const hhmm = (v) => (typeof v === 'string' && v.trim() && /^\d{1,2}:\d{2}$/.test(v.trim()) ? v.trim() : null);
    const start = hhmm(startTime) || '09:00';
    const end = hhmm(endTime) || '10:00';
    const title = typeof eventTitle === 'string' && eventTitle.trim() ? eventTitle.trim() : (typeof subject === 'string' && subject.trim() ? subject.trim() : 'Meeting');
    const name = typeof clientName === 'string' && clientName.trim() ? clientName.trim() : null;

    const dateFormatted = dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const greeting = name ? `Hi ${name},` : 'Hi,';
    const text = `${greeting}\n\nYour appointment has been scheduled:\n\n${title}\n${dateFormatted}\n${start} – ${end}\n\nSee you then!`;

    const escapeHtml = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const bodyHtml = escapeHtml(text).replace(/\n/g, '<br>\n');
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #333; max-width: 560px;">
  <div>${bodyHtml}</div>
</body>
</html>`;

    const resend = new Resend(resendApiKey);
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [to.trim()],
      subject: `Confirmed: ${title} on ${dateFormatted}`,
      text,
      html: html.trim(),
    });

    if (error) {
      const msg = error.message || (typeof error === 'string' ? error : 'Resend rejected the email.');
      console.error('[send-confirmation-email] Resend error:', error);
      return sendError(400, msg);
    }
    sendJson(res, 200, { id: data?.id, ok: true });
  } catch (err) {
    const raw = (err && err.message) || (err != null ? String(err) : '');
    const msg = (typeof raw === 'string' && raw.trim())
      ? raw.trim()
      : 'Email send failed. Check RESEND_API_KEY and FROM_EMAIL in .env.';
    console.error('[send-confirmation-email] Exception:', err);
    sendError(500, msg);
  }
});

app.listen(port, () => {
  console.log(`Scheduler API running at http://localhost:${port}`);
  if (!resendApiKey) {
    console.log('RESEND_API_KEY not set — "Send via app" will be unavailable. Use "Open in email" or set the key.');
  } else if (fromEmailRaw.trim() && !isValidFromEmail(fromEmail)) {
    console.warn('FROM_EMAIL in .env is invalid. Use "Name <you@domain.com>" or leave unset for onboarding@resend.dev.');
  }
});
