import { Resend } from "resend";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

const resendApiKey = process.env.RESEND_API_KEY;
const fromEmailRaw = process.env.FROM_EMAIL || "";
const fromEmail = fromEmailRaw.trim() || "Scheduler <onboarding@resend.dev>";
const baseUrl = process.env.BASE_URL || "http://localhost:3000";

export function isValidFromEmail(value: unknown): boolean {
  if (!value || typeof value !== "string") return false;
  const s = value.trim();
  const simple = /^[^\s<]+@[^\s>]+$/;
  const withName = /^[^<]*<[^\s@]+@[^\s>]+>$/;
  return simple.test(s) || withName.test(s);
}

// Data storage (JSON files for local dev; on Vercel you should switch to a managed DB)
const dataDir = path.join(process.cwd(), "..", "data");
const scheduleRequestsPath = path.join(dataDir, "schedule-requests.json");
const calendarEventsPath = path.join(dataDir, "calendar-events.json");
const contactsPath = path.join(dataDir, "contacts.json");

export interface ScheduleResponse {
  selectedDate: string;
  selectedSlot: string;
  respondentName?: string;
  respondentEmail?: string;
  respondentPhone?: string;
  respondentNotes?: string;
  respondentStreet?: string;
  respondentAddress2?: string;
  respondentCity?: string;
  respondentState?: string;
  respondentPostalCode?: string;
  respondedAt: string;
}

export interface ScheduleRequest {
  id: string;
  to: string;
  recipientName?: string | null;
  subject: string;
  proposedDates: string[];
  eventTitle: string | null;
  createdAt: string;
  responses?: ScheduleResponse[];
  response?: {
    selectedDates: string[];
    selectedSlot?: string;
    respondentName?: string;
    respondentEmail?: string;
    respondentPhone?: string;
    respondentNotes?: string;
    respondedAt?: string;
  };
  hourSlots?: string[];
  archived?: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
}

export interface ContactMeeting {
  requestId: string;
  subject: string | null;
  eventTitle: string | null;
  selectedDate: string | null;
  selectedSlot: string | null;
  respondedAt: string | null;
}

export interface Contact {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  notes: string | null;
  addressStreet: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPostalCode: string | null;
  createdAt: string;
  updatedAt: string;
  lastMeetingAt: string | null;
  meetings: ContactMeeting[];
}

const scheduleRequests = new Map<string, ScheduleRequest>();
let calendarEvents: CalendarEvent[] = [];
const contacts = new Map<string, Contact>();

function ensureDataDir() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch {
    // ignore
  }
}

function loadScheduleRequestsFromFile() {
  try {
    const raw = fs.readFileSync(scheduleRequestsPath, "utf8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    scheduleRequests.clear();
    arr.forEach((r: ScheduleRequest) => {
      if (r && r.id) scheduleRequests.set(r.id, r);
    });
  } catch (err: unknown) {
    if (err.code !== "ENOENT") console.error("[schedule-requests] load error:", err.message);
  }
}

function saveScheduleRequestsToFile() {
  try {
    ensureDataDir();
    const arr = Array.from(scheduleRequests.values());
    fs.writeFileSync(scheduleRequestsPath, JSON.stringify(arr, null, 2), "utf8");
  } catch (err: unknown) {
    console.error("[schedule-requests] save error:", err.message);
  }
}

function loadCalendarEventsFromFile() {
  try {
    const raw = fs.readFileSync(calendarEventsPath, "utf8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    calendarEvents = arr.filter(
      (e: unknown) =>
        e &&
        typeof e.id === "string" &&
        typeof e.title === "string" &&
        typeof e.start === "string" &&
        typeof e.end === "string",
    );
  } catch (err: unknown) {
    if (err.code !== "ENOENT") console.error("[calendar-events] load error:", err.message);
  }
}

function saveCalendarEventsToFile() {
  try {
    ensureDataDir();
    fs.writeFileSync(calendarEventsPath, JSON.stringify(calendarEvents, null, 2), "utf8");
  } catch (err: unknown) {
    console.error("[calendar-events] save error:", err.message);
  }
}

function loadContactsFromFile() {
  try {
    const raw = fs.readFileSync(contactsPath, "utf8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    contacts.clear();
    arr.forEach((c: unknown) => {
      const contact = c as { email?: string };
      if (!contact || typeof contact.email !== "string") return;
      const email = contact.email.trim();
      if (!email) return;
      const key = email.toLowerCase();
      contacts.set(key, contact as Contact);
    });
  } catch (err: unknown) {
    if (err.code !== "ENOENT") console.error("[contacts] load error:", err.message);
  }
}

function saveContactsToFile() {
  try {
    ensureDataDir();
    const arr = Array.from(contacts.values());
    fs.writeFileSync(contactsPath, JSON.stringify(arr, null, 2), "utf8");
  } catch (err: unknown) {
    console.error("[contacts] save error:", err.message);
  }
}

// Load data at module init (good for dev; in serverless each cold start reloads)
loadScheduleRequestsFromFile();
loadCalendarEventsFromFile();
loadContactsFromFile();

export const HOUR_SLOTS = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
];

export function isValidSlot(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim() !== "" && HOUR_SLOTS.includes(s.trim());
}

export function normalizeResponses(req_: ScheduleRequest): ScheduleResponse[] {
  const responses = req_.responses && Array.isArray(req_.responses) ? req_.responses : [];
  if (responses.length > 0) return responses;
  if (req_.response && Array.isArray(req_.response.selectedDates) && req_.response.selectedDates.length > 0) {
    return [
      {
        selectedDate: req_.response.selectedDates[0],
        selectedSlot: req_.response.selectedSlot || "09:00",
        respondentName: req_.response.respondentName,
        respondentEmail: req_.response.respondentEmail,
        respondentPhone: req_.response.respondentPhone,
        respondentNotes: req_.response.respondentNotes,
        respondedAt: req_.response.respondedAt || new Date().toISOString(),
      },
    ];
  }
  return [];
}

export function takenSlotsFromResponses(responses: ScheduleResponse[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  (responses || []).forEach((r) => {
    if (r.selectedDate && r.selectedSlot) {
      const d = String(r.selectedDate).slice(0, 10);
      if (!out[d]) out[d] = [];
      if (!out[d].includes(r.selectedSlot)) out[d].push(r.selectedSlot);
    }
  });
  return out;
}

export function mergeTakenSlots(
  target: Record<string, string[]>,
  source: Record<string, string[]>,
): Record<string, string[]> {
  Object.keys(source).forEach((date) => {
    if (!target[date]) target[date] = [];
    source[date].forEach((slot) => {
      if (!target[date].includes(slot)) target[date].push(slot);
    });
  });
  return target;
}

export function takenSlotsFromCalendarEvents(events: CalendarEvent[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  (events || []).forEach((evt: CalendarEvent) => {
    if (!evt || !evt.start || !evt.end) return;
    const start = new Date(evt.start);
    const end = new Date(evt.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    const dateStr = start.toISOString().slice(0, 10);
    let hour = start.getHours();
    const endHour = end.getHours();
    while (hour < endHour) {
      const slot = `${String(hour).padStart(2, "0")}:00`;
      if (HOUR_SLOTS.includes(slot)) {
        if (!out[dateStr]) out[dateStr] = [];
        if (!out[dateStr].includes(slot)) out[dateStr].push(slot);
      }
      hour += 1;
    }
  });
  return out;
}

export function allTakenSlots(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const fromCalendar = takenSlotsFromCalendarEvents(calendarEvents);
  mergeTakenSlots(out, fromCalendar);
  scheduleRequests.forEach((req_) => {
    if (req_ && req_.archived) return;
    const responses = normalizeResponses(req_);
    const taken = takenSlotsFromResponses(responses);
    mergeTakenSlots(out, taken);
  });
  return out;
}

export function addCalendarEventForResponse(
  req_: ScheduleRequest,
  responseEntry: ScheduleResponse,
): void {
  if (!req_ || !responseEntry) return;
  const dateStr = responseEntry.selectedDate;
  const startSlot = responseEntry.selectedSlot;
  if (!dateStr || !startSlot) return;

  const [startHRaw, startMRaw] = String(startSlot)
    .split(":")
    .map(Number);
  const startH = Number.isNaN(startHRaw) ? 9 : startHRaw;
  const startM = Number.isNaN(startMRaw) ? 0 : startMRaw;
  const endH = startH + 1;
  const endM = startM;

  const base = new Date(dateStr + "T12:00:00");
  if (Number.isNaN(base.getTime())) return;

  const start = new Date(base);
  start.setHours(startH, startM, 0, 0);
  const end = new Date(base);
  end.setHours(endH, endM, 0, 0);

  const displayName = responseEntry.respondentName || req_.recipientName || req_.to || null;
  const eventTitle = req_.eventTitle || req_.subject || "Scheduled meeting";
  const titleWithName = displayName ? `${eventTitle} with ${displayName}` : eventTitle;

  const id = `request-${req_.id}-${dateStr}-${startSlot}`;
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

export function addOrUpdateContactFromResponse(
  req_: ScheduleRequest,
  responseEntry: ScheduleResponse,
): void {
  if (!responseEntry || !responseEntry.respondentEmail) return;
  const emailRaw = String(responseEntry.respondentEmail).trim();
  if (!emailRaw) return;
  const emailKey = emailRaw.toLowerCase();
  const nowIso = new Date().toISOString();

  const meeting: ContactMeeting = {
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

// ---- Public API helpers used by Next route handlers ----

export function getHealth() {
  return {
    status: 200,
    body: { ok: true, resend: !!resendApiKey, version: "slots-v2" },
  };
}

export function getScheduleRequestById(id: string) {
  const req_ = scheduleRequests.get(id);
  if (!req_) {
    return {
      status: 404,
      body: { message: "Schedule request not found or expired." },
    };
  }
  const responses = normalizeResponses(req_);
  const takenSlots = allTakenSlots();
  const hourSlots =
    Array.isArray(req_.hourSlots) && req_.hourSlots.length > 0 ? req_.hourSlots : HOUR_SLOTS;
  return {
    status: 200,
    body: {
      id: req_.id,
      subject: req_.subject,
      proposedDates: req_.proposedDates || [],
      eventTitle: req_.eventTitle,
      responses,
      takenSlots,
      hourSlots,
    },
  };
}

export function listScheduleRequests() {
  const list = Array.from(scheduleRequests.values())
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
  return { status: 200, body: { requests: list } };
}

export function deleteScheduleRequest(id: string) {
  if (!scheduleRequests.has(id)) {
    return {
      status: 404,
      body: { message: "Schedule request not found or already deleted." },
    };
  }
  scheduleRequests.delete(id);
  saveScheduleRequestsToFile();
  return { status: 200, body: { ok: true } };
}

export function patchScheduleRequest(
  id: string,
  body: { archive?: boolean; removeResponse?: { selectedDate: string; selectedSlot: string } },
) {
  const req_ = scheduleRequests.get(id);
  if (!req_) {
    return {
      status: 404,
      body: { message: "Schedule request not found or already deleted." },
    };
  }

  if (body.archive === true) {
    req_.archived = true;
    saveScheduleRequestsToFile();
    return { status: 200, body: { ok: true, archived: true } };
  }

  const remove = body.removeResponse;
  if (!remove || typeof remove.selectedDate !== "string" || typeof remove.selectedSlot !== "string") {
    return {
      status: 400,
      body: {
        message: "removeResponse: { selectedDate, selectedSlot } required when not archiving.",
      },
    };
  }
  const dateStr = remove.selectedDate.trim().slice(0, 10);
  const slot = remove.selectedSlot.trim();
  if (!req_.responses || !Array.isArray(req_.responses)) {
    req_.responses = normalizeResponses(req_);
    if (req_.response) delete req_.response;
  }
  req_.responses = req_.responses.filter(
    (r) => r.selectedDate !== dateStr || r.selectedSlot !== slot,
  );
  saveScheduleRequestsToFile();
  return { status: 200, body: { ok: true } };
}

export function getCalendarEvents() {
  return { status: 200, body: { events: calendarEvents } };
}

export function syncCalendarEvents(incoming: { events?: unknown }) {
  const arr = Array.isArray(incoming?.events) ? (incoming.events as unknown[]) : [];
  const next = arr
    .map((e) => {
      if (
        !e ||
        typeof e.id !== "string" ||
        typeof e.title !== "string" ||
        typeof e.start !== "string" ||
        typeof e.end !== "string"
      ) {
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
      } as CalendarEvent;
    })
    .filter(Boolean) as CalendarEvent[];
  calendarEvents = next;
  saveCalendarEventsToFile();
  return { status: 200, body: { ok: true, count: calendarEvents.length } };
}

export function listContacts() {
  const list = Array.from(contacts.values());
  return { status: 200, body: { contacts: list } };
}

export function respondToScheduleRequest(
  id: string,
  body: Partial<ScheduleResponse> & { selectedDate?: string; selectedSlot?: string },
) {
  const req_ = scheduleRequests.get(id);
  if (!req_) {
    return { status: 404, body: { message: "Schedule request not found or expired." } };
  }

  let selectedDate =
    typeof body.selectedDate === "string" && body.selectedDate.trim()
      ? body.selectedDate.trim()
      : "";
  let selectedSlot =
    typeof body.selectedSlot === "string" && body.selectedSlot.trim()
      ? body.selectedSlot.trim()
      : "";

  const legacySelectedDates =
    (body as { selectedDates?: unknown }).selectedDates && Array.isArray((body as { selectedDates?: unknown }).selectedDates)
      ? ((body as { selectedDates?: unknown }).selectedDates as unknown[])
      : null;

  if (!selectedDate && legacySelectedDates) {
    const first = legacySelectedDates.find(
      (d: unknown) => typeof d === "string" && d.trim(),
    );
    if (first) {
      selectedDate = new Date((first as string).trim()).toISOString().slice(0, 10);
    }
    if (!selectedSlot || !isValidSlot(selectedSlot)) selectedSlot = "09:00";
  }

  const dateNorm =
    selectedDate && selectedDate.match(/^\d{4}-\d{2}-\d{2}$/) ? selectedDate : null;
  if (!dateNorm) {
    return { status: 400, body: { message: "selectedDate is required (YYYY-MM-DD)." } };
  }
  if (!isValidSlot(selectedSlot)) {
    return {
      status: 400,
      body: { message: "selectedSlot must be one of: " + HOUR_SLOTS.join(", ") + "." },
    };
  }

  const proposedSet = new Set(req_.proposedDates || []);
  if (proposedSet.size > 0 && !proposedSet.has(dateNorm)) {
    return {
      status: 400,
      body: { message: "You can only choose from the dates offered." },
    };
  }

  const taken = allTakenSlots();
  if (taken[dateNorm] && taken[dateNorm].includes(selectedSlot)) {
    return {
      status: 409,
      body: {
        message: "That time slot is already taken. Please choose another date or time.",
      },
    };
  }

  const entry: ScheduleResponse = {
    selectedDate: dateNorm,
    selectedSlot,
    respondentName:
      typeof body.respondentName === "string" && body.respondentName.trim()
        ? body.respondentName.trim()
        : undefined,
    respondentEmail:
      typeof body.respondentEmail === "string" && body.respondentEmail.trim()
        ? body.respondentEmail.trim()
        : undefined,
    respondentPhone:
      typeof body.respondentPhone === "string" && body.respondentPhone.trim()
        ? body.respondentPhone.trim()
        : undefined,
    respondentNotes:
      typeof body.respondentNotes === "string" && body.respondentNotes.trim()
        ? body.respondentNotes.trim()
        : undefined,
    respondentStreet:
      typeof body.respondentStreet === "string" && body.respondentStreet.trim()
        ? body.respondentStreet.trim()
        : undefined,
    respondentAddress2:
      typeof body.respondentAddress2 === "string" && body.respondentAddress2.trim()
        ? body.respondentAddress2.trim()
        : undefined,
    respondentCity:
      typeof body.respondentCity === "string" && body.respondentCity.trim()
        ? body.respondentCity.trim()
        : undefined,
    respondentState:
      typeof body.respondentState === "string" && body.respondentState.trim()
        ? body.respondentState.trim()
        : undefined,
    respondentPostalCode:
      typeof body.respondentPostalCode === "string" && body.respondentPostalCode.trim()
        ? body.respondentPostalCode.trim()
        : undefined,
    respondedAt: new Date().toISOString(),
  };

  if (!req_.responses) {
    req_.responses = [];
    if (req_.response) {
      const legacy = req_.response;
      if (Array.isArray(legacy.selectedDates) && legacy.selectedDates.length > 0) {
        req_.responses.push({
          selectedDate: legacy.selectedDates[0],
          selectedSlot: legacy.selectedSlot || "09:00",
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

  const takenNow = allTakenSlots();
  if (takenNow[dateNorm] && takenNow[dateNorm].includes(selectedSlot)) {
    return {
      status: 409,
      body: {
        message: "That time slot is already taken. Please choose another date or time.",
      },
    };
  }

  req_.responses!.push(entry);
  try {
    addOrUpdateContactFromResponse(req_, entry);
  } catch (err: unknown) {
    console.error(
      "[contacts] failed to upsert contact from response:",
      err && err.message ? err.message : err,
    );
  }
  try {
    addCalendarEventForResponse(req_, entry);
  } catch (err: unknown) {
    console.error(
      "[schedule-requests] failed to add calendar event from response:",
      err && err.message ? err.message : err,
    );
  }
  saveScheduleRequestsToFile();
  return { status: 200, body: { ok: true, selectedDate: dateNorm, selectedSlot } };
}

export async function sendScheduleEmail(body: {
  to: string;
  subject?: string;
  eventTitle?: string;
  recipientName?: string;
  proposedDates?: string[];
  messageBody?: string;
}) {
  if (!resendApiKey) {
    return {
      status: 503,
      body: {
        message:
          'Email sending is not configured. Set RESEND_API_KEY in environment, or use "Open in email".',
      },
    };
  }
  if (!isValidFromEmail(fromEmail)) {
    return {
      status: 400,
      body: {
        message:
          'Invalid FROM_EMAIL in environment. Use "Name <you@domain.com>" or "you@domain.com".',
      },
    };
  }

  const { to, subject, eventTitle, recipientName, proposedDates, messageBody } = body;
  if (!to || typeof to !== "string" || !to.trim()) {
    return { status: 400, body: { message: "Recipient email (to) is required." } };
  }

  const normalizeEmails = (value: string) =>
    value
      .split(/[;,]+/)
      .map((part) => part.trim())
      .filter(Boolean);

  const toList = normalizeEmails(to);
  if (toList.length === 0) {
    return { status: 400, body: { message: "At least one valid recipient email is required." } };
  }

  const resend = new Resend(resendApiKey);
  let text = typeof messageBody === "string" ? messageBody : "";
  const subj =
    typeof subject === "string" && subject.trim()
      ? subject.trim()
      : "Let's schedule a time to meet";

  const requestId = randomUUID();
  const proposedDatesList = Array.isArray(proposedDates)
    ? proposedDates
        .filter((d) => typeof d === "string" && d.trim())
        .map((d) => new Date(d.trim()).toISOString().slice(0, 10))
        .filter((d) => d && d.match(/^\d{4}-\d{2}-\d{2}$/))
    : [];

  const basePath = `${baseUrl.replace(/\/$/, "")}/respond/${requestId}`;
  const respondUrl =
    proposedDatesList.length > 0
      ? `${basePath}?dates=${encodeURIComponent(proposedDatesList.join(","))}`
      : basePath;

  const recipientNameStr =
    typeof recipientName === "string" && recipientName.trim()
      ? recipientName.trim()
      : null;

  scheduleRequests.set(requestId, {
    id: requestId,
    to: toList.join(", "),
    recipientName: recipientNameStr || undefined,
    subject: subj,
    proposedDates: proposedDatesList,
    eventTitle: typeof eventTitle === "string" ? eventTitle : null,
    createdAt: new Date().toISOString(),
    responses: [],
  });
  saveScheduleRequestsToFile();

  text += `\n\nChoose your time slot (9 AM – 5 PM): ${respondUrl}`;

  const escapeHtml = (s: string) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const bodyHtml = escapeHtml(text).replace(/\n/g, "<br>\n");
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #333; max-width: 560px;">
  <div style="margin-bottom: 24px;">${bodyHtml}</div>
  <p style="margin: 24px 0 0 0;">
    <a href="${escapeHtml(
      respondUrl,
    )}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Choose your time slot</a>
  </p>
</body>
</html>`.trim();

  const { data, error } = await resend.emails.send({
    from: fromEmail,
    to: toList,
    subject: subj,
    text: text || "No message body.",
    html,
  });

  if (error) {
    scheduleRequests.delete(requestId);
    saveScheduleRequestsToFile();
    const msg =
      (typeof (error as { message?: string }).message === "string" &&
        (error as { message?: string }).message) ||
      (typeof error === "string" ? error : "Resend rejected the email.");
    console.error("[send-schedule-email] Resend error:", error);
    return { status: 400, body: { message: msg } };
  }

  return {
    status: 200,
    body: { id: (data as { id?: string } | null | undefined)?.id, ok: true, requestId, respondUrl },
  };
}

export function createEventLink(body: {
  subject?: string;
  eventTitle?: string;
  proposedDates?: string[];
  startHour?: string;
  endHour?: string;
}) {
  const rawSubject = typeof body.subject === "string" ? body.subject.trim() : "";
  const rawEventTitle = typeof body.eventTitle === "string" ? body.eventTitle.trim() : "";
  const subj = rawSubject || rawEventTitle || "Let's schedule a time to meet";

  const proposedDatesList = Array.isArray(body.proposedDates)
    ? body.proposedDates
        .filter((d) => typeof d === "string" && d.trim())
        .map((d) => new Date(d.trim()).toISOString().slice(0, 10))
        .filter((d) => d && d.match(/^\d{4}-\d{2}-\d{2}$/))
    : [];

  if (proposedDatesList.length === 0) {
    return { status: 400, body: { message: "At least one allowed date is required." } };
  }

  const startHour =
    typeof body.startHour === "string" && body.startHour.match(/^\d{2}:\d{2}$/)
      ? body.startHour
      : "09:00";
  const endHour =
    typeof body.endHour === "string" && body.endHour.match(/^\d{2}:\d{2}$/)
      ? body.endHour
      : "17:00";

  const hourSlots = HOUR_SLOTS.filter((slot) => slot >= startHour && slot < endHour);
  if (hourSlots.length === 0) {
    return {
      status: 400,
      body: {
        message:
          "Time frame must include at least one one-hour slot between 9 AM and 5 PM.",
      },
    };
  }

  const requestId = randomUUID();
  const basePath = `${baseUrl.replace(/\/$/, "")}/respond/${requestId}`;
  const respondUrl = basePath;

  scheduleRequests.set(requestId, {
    id: requestId,
    to: "",
    recipientName: undefined,
    subject: subj,
    proposedDates: proposedDatesList,
    eventTitle: rawEventTitle || null,
    createdAt: new Date().toISOString(),
    responses: [],
    hourSlots,
  });
  saveScheduleRequestsToFile();

  return {
    status: 200,
    body: { ok: true, requestId, respondUrl, hourSlots, proposedDates: proposedDatesList },
  };
}

export async function sendConfirmationEmail(body: {
  to: string;
  clientName?: string;
  dateStr: string;
  startTime?: string;
  endTime?: string;
  eventTitle?: string;
  subject?: string;
}) {
  if (!resendApiKey) {
    return {
      status: 503,
      body: {
        message:
          "Email sending is not configured. Set RESEND_API_KEY in environment to notify clients.",
      },
    };
  }
  if (!isValidFromEmail(fromEmail)) {
    return {
      status: 400,
      body: {
        message:
          'Invalid FROM_EMAIL in environment. Use "Name <you@domain.com>" or "you@domain.com".',
      },
    };
  }

  const { to, clientName, dateStr, startTime, endTime, eventTitle, subject } = body;
  if (!to || typeof to !== "string" || !to.trim()) {
    return { status: 400, body: { message: "Recipient email (to) is required." } };
  }
  if (!dateStr || typeof dateStr !== "string" || !dateStr.trim()) {
    return { status: 400, body: { message: "Date (dateStr) is required." } };
  }

  const dateObj = new Date(dateStr.trim() + "T12:00:00");
  if (Number.isNaN(dateObj.getTime())) {
    return {
      status: 400,
      body: { message: "Invalid date format. Use YYYY-MM-DD." },
    };
  }

  const hhmm = (v?: string) =>
    v && v.trim() && /^\d{1,2}:\d{2}$/.test(v.trim()) ? v.trim() : null;
  const start = hhmm(startTime) || "09:00";
  const end = hhmm(endTime) || "10:00";
  const title =
    (eventTitle && eventTitle.trim()) ||
    (subject && subject.trim()) ||
    "Meeting";
  const name = clientName && clientName.trim() ? clientName.trim() : null;

  const dateFormatted = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const greeting = name ? `Hi ${name},` : "Hi,";
  const text = `${greeting}\n\nYour appointment has been scheduled:\n\n${title}\n${dateFormatted}\n${start} – ${end}\n\nSee you then!`;

  const escapeHtml = (s: string) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const bodyHtml = escapeHtml(text).replace(/\n/g, "<br>\n");
  const html = `
<!DOCTYPE html>
\n<html>
<head><meta charset="utf-8"></head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #333; max-width: 560px;">
  <div>${bodyHtml}</div>
</body>
</html>`.trim();

  const resend = new Resend(resendApiKey);
  const { data, error } = await resend.emails.send({
    from: fromEmail,
    to: [to.trim()],
    subject: `Confirmed: ${title} on ${dateFormatted}`,
    text,
    html,
  });

  if (error) {
    const msg =
      (typeof (error as { message?: string }).message === "string" &&
        (error as { message?: string }).message) ||
      (typeof error === "string" ? error : "Resend rejected the email.");
    console.error("[send-confirmation-email] Resend error:", error);
    return { status: 400, body: { message: msg } };
  }
  return {
    status: 200,
    body: { id: (data as { id?: string } | null | undefined)?.id, ok: true },
  };
}

