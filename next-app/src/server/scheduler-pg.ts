import { Resend } from "resend";
import { randomUUID } from "crypto";
import { sql } from "@vercel/postgres";

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
  hourSlots?: string[];
  archived?: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
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
}

type StateKey = "scheduleRequests" | "calendarEvents" | "contacts";

interface SchedulerState {
  scheduleRequests: ScheduleRequest[];
  calendarEvents: CalendarEvent[];
  contacts: Contact[];
}

async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS scheduler_state (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    )
  `;
}

async function loadStatePart<K extends StateKey>(key: K): Promise<SchedulerState[K]> {
  await ensureSchema();
  const result = await sql<{ value: unknown }>`SELECT value FROM scheduler_state WHERE key = ${key}`;
  if (result.rows.length === 0 || result.rows[0].value == null) {
    return [] as SchedulerState[K];
  }
  return result.rows[0].value as SchedulerState[K];
}

async function saveStatePart<K extends StateKey>(key: K, value: SchedulerState[K]): Promise<void> {
  await ensureSchema();
  await sql`
    INSERT INTO scheduler_state (key, value)
    VALUES (${key}, ${value}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

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
  return responses;
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
  (events || []).forEach((evt) => {
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

export function allTakenSlots(
  requests: ScheduleRequest[],
  events: CalendarEvent[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const fromCalendar = takenSlotsFromCalendarEvents(events);
  mergeTakenSlots(out, fromCalendar);
  requests.forEach((req_) => {
    if (req_ && req_.archived) return;
    const responses = normalizeResponses(req_);
    const taken = takenSlotsFromResponses(responses);
    mergeTakenSlots(out, taken);
  });
  return out;
}

function addCalendarEventForResponse(
  calendarEvents: CalendarEvent[],
  req_: ScheduleRequest,
  responseEntry: ScheduleResponse,
): CalendarEvent[] {
  if (!req_ || !responseEntry) return calendarEvents;
  const dateStr = responseEntry.selectedDate;
  const startSlot = responseEntry.selectedSlot;
  if (!dateStr || !startSlot) return calendarEvents;

  const [startHRaw, startMRaw] = String(startSlot)
    .split(":")
    .map(Number);
  const startH = Number.isNaN(startHRaw) ? 9 : startHRaw;
  const startM = Number.isNaN(startMRaw) ? 0 : startMRaw;
  const endH = startH + 1;
  const endM = startM;

  const base = new Date(dateStr + "T12:00:00");
  if (Number.isNaN(base.getTime())) return calendarEvents;

  const start = new Date(base);
  start.setHours(startH, startM, 0, 0);
  const end = new Date(base);
  end.setHours(endH, endM, 0, 0);

  const displayName = responseEntry.respondentName || req_.recipientName || req_.to || null;
  const eventTitle = req_.eventTitle || req_.subject || "Scheduled meeting";
  const titleWithName = displayName ? `${eventTitle} with ${displayName}` : eventTitle;

  const id = `request-${req_.id}-${dateStr}-${startSlot}`;
  const exists = calendarEvents.some((e) => e && e.id === id);
  if (exists) return calendarEvents;

  return [
    ...calendarEvents,
    {
      id,
      title: titleWithName,
      start: start.toISOString(),
      end: end.toISOString(),
    },
  ];
}

function addOrUpdateContactFromResponse(
  contacts: Contact[],
  req_: ScheduleRequest,
  responseEntry: ScheduleResponse,
): Contact[] {
  if (!responseEntry || !responseEntry.respondentEmail) return contacts;
  const emailRaw = String(responseEntry.respondentEmail).trim();
  if (!emailRaw) return contacts;
  const emailKey = emailRaw.toLowerCase();
  const nowIso = new Date().toISOString();

  const existing = contacts.find((c) => c.email.toLowerCase() === emailKey);
  if (existing) {
    const updated: Contact = {
      ...existing,
      name: existing.name || responseEntry.respondentName || null,
      phone: existing.phone || responseEntry.respondentPhone || null,
      notes: existing.notes || responseEntry.respondentNotes || null,
      addressStreet: existing.addressStreet || responseEntry.respondentStreet || null,
      addressLine2: existing.addressLine2 || responseEntry.respondentAddress2 || null,
      addressCity: existing.addressCity || responseEntry.respondentCity || null,
      addressState: existing.addressState || responseEntry.respondentState || null,
      addressPostalCode: existing.addressPostalCode || responseEntry.respondentPostalCode || null,
      lastMeetingAt: responseEntry.respondedAt || nowIso,
      updatedAt: nowIso,
    };
    return contacts.map((c) => (c.email.toLowerCase() === emailKey ? updated : c));
  }

  const created: Contact = {
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
    lastMeetingAt: responseEntry.respondedAt || nowIso,
  };
  return [...contacts, created];
}

export function getHealth() {
  return {
    status: 200,
    body: { ok: true, resend: !!resendApiKey, version: "slots-pg" },
  };
}

export async function getScheduleRequestById(id: string) {
  const [scheduleRequests, calendarEvents] = await Promise.all([
    loadStatePart("scheduleRequests"),
    loadStatePart("calendarEvents"),
  ]);
  const req_ = scheduleRequests.find((r) => r.id === id);
  if (!req_) {
    return {
      status: 404,
      body: { message: "Schedule request not found or expired." },
    };
  }
  const responses = normalizeResponses(req_);
  const takenSlots = allTakenSlots(scheduleRequests, calendarEvents);
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

export async function listScheduleRequests() {
  const scheduleRequests = await loadStatePart("scheduleRequests");
  const list = scheduleRequests
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

export async function deleteScheduleRequest(id: string) {
  const scheduleRequests = await loadStatePart("scheduleRequests");
  const exists = scheduleRequests.some((r) => r.id === id);
  if (!exists) {
    return {
      status: 404,
      body: { message: "Schedule request not found or already deleted." },
    };
  }
  const next = scheduleRequests.filter((r) => r.id !== id);
  await saveStatePart("scheduleRequests", next);
  return { status: 200, body: { ok: true } };
}

export async function patchScheduleRequest(
  id: string,
  body: { archive?: boolean; removeResponse?: { selectedDate: string; selectedSlot: string } },
) {
  const scheduleRequests = await loadStatePart("scheduleRequests");
  const idx = scheduleRequests.findIndex((r) => r.id === id);
  if (idx === -1) {
    return {
      status: 404,
      body: { message: "Schedule request not found or already deleted." },
    };
  }
  const req_ = scheduleRequests[idx];

  if (body.archive === true) {
    const updated: ScheduleRequest = { ...req_, archived: true };
    const next = [...scheduleRequests];
    next[idx] = updated;
    await saveStatePart("scheduleRequests", next);
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

  const normalizedResponses = normalizeResponses(req_);
  const filteredResponses = normalizedResponses.filter(
    (r) => r.selectedDate !== dateStr || r.selectedSlot !== slot,
  );

  const updated: ScheduleRequest = {
    ...req_,
    responses: filteredResponses,
  };
  const next = [...scheduleRequests];
  next[idx] = updated;
  await saveStatePart("scheduleRequests", next);
  return { status: 200, body: { ok: true } };
}

export async function getCalendarEvents() {
  const calendarEvents = await loadStatePart("calendarEvents");
  return { status: 200, body: { events: calendarEvents } };
}

export async function syncCalendarEvents(incoming: { events?: unknown }) {
  const arr = Array.isArray(incoming?.events) ? (incoming.events as unknown[]) : [];
  const next: CalendarEvent[] = arr
    .map((e) => {
      const evt = e as Partial<CalendarEvent>;
      if (!evt || !evt.id || !evt.title || !evt.start || !evt.end) return null;
      const start = new Date(evt.start);
      const end = new Date(evt.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
      return {
        id: evt.id,
        title: evt.title,
        start: start.toISOString(),
        end: end.toISOString(),
      };
    })
    .filter((v): v is CalendarEvent => v !== null);
  await saveStatePart("calendarEvents", next);
  return { status: 200, body: { ok: true, count: next.length } };
}

export async function listContacts() {
  const contacts = await loadStatePart("contacts");
  return { status: 200, body: { contacts } };
}

export async function respondToScheduleRequest(
  id: string,
  body: Partial<ScheduleResponse> & { selectedDate?: string; selectedSlot?: string; selectedDates?: string[] },
) {
  const [scheduleRequests, calendarEvents, contacts] = await Promise.all([
    loadStatePart("scheduleRequests"),
    loadStatePart("calendarEvents"),
    loadStatePart("contacts"),
  ]);

  const idx = scheduleRequests.findIndex((r) => r.id === id);
  if (idx === -1) {
    return { status: 404, body: { message: "Schedule request not found or expired." } };
  }
  const req_ = scheduleRequests[idx];

  let selectedDate =
    typeof body.selectedDate === "string" && body.selectedDate.trim()
      ? body.selectedDate.trim()
      : "";
  let selectedSlot =
    typeof body.selectedSlot === "string" && body.selectedSlot.trim()
      ? body.selectedSlot.trim()
      : "";

  const legacySelectedDates =
    body.selectedDates && Array.isArray(body.selectedDates) ? body.selectedDates : null;

  if (!selectedDate && legacySelectedDates) {
    const first = legacySelectedDates.find(
      (d: unknown) => typeof d === "string" && (d as string).trim(),
    );
    if (typeof first === "string") {
      selectedDate = new Date(first.trim()).toISOString().slice(0, 10);
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

  const taken = allTakenSlots(scheduleRequests, calendarEvents);
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

  const existingResponses = normalizeResponses(req_);
  const updatedReq: ScheduleRequest = {
    ...req_,
    responses: [...existingResponses, entry],
  };

  const updatedContacts = addOrUpdateContactFromResponse(contacts, updatedReq, entry);
  const updatedEvents = addCalendarEventForResponse(calendarEvents, updatedReq, entry);

  const nextRequests = [...scheduleRequests];
  nextRequests[idx] = updatedReq;

  await Promise.all([
    saveStatePart("scheduleRequests", nextRequests),
    saveStatePart("calendarEvents", updatedEvents),
    saveStatePart("contacts", updatedContacts),
  ]);

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

  const scheduleRequests = await loadStatePart("scheduleRequests");

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

  const newRequest: ScheduleRequest = {
    id: requestId,
    to: toList.join(", "),
    recipientName: recipientNameStr || undefined,
    subject: subj,
    proposedDates: proposedDatesList,
    eventTitle: typeof eventTitle === "string" ? eventTitle : null,
    createdAt: new Date().toISOString(),
    responses: [],
  };

  const nextRequests = [...scheduleRequests, newRequest];
  await saveStatePart("scheduleRequests", nextRequests);

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

export async function createEventLink(body: {
  subject?: string;
  eventTitle?: string;
  proposedDates?: string[];
  startHour?: string;
  endHour?: string;
}) {
  const scheduleRequests = await loadStatePart("scheduleRequests");

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

  const newRequest: ScheduleRequest = {
    id: requestId,
    to: "",
    recipientName: undefined,
    subject: subj,
    proposedDates: proposedDatesList,
    eventTitle: rawEventTitle || null,
    createdAt: new Date().toISOString(),
    responses: [],
    hourSlots,
  };

  const nextRequests = [...scheduleRequests, newRequest];
  await saveStatePart("scheduleRequests", nextRequests);

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
<html>
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

