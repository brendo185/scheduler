import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { format, isSameDay } from 'date-fns';
import { Calendar } from './Calendar';
import { EmailScheduleModal } from './EmailScheduleModal';
import { CreateEventLinkModal } from './CreateEventLinkModal';
import { AddJobModal } from './AddJobModal';
import { JobDetailsModal } from './JobDetailsModal';
import { MeetingDetailModal } from './MeetingDetailModal';
import { TimeTracker } from './TimeTracker';
import type { ScheduleEvent } from '../types';
import './Dashboard.css';
import type { SidePanelTab } from '../App';
import * as auth from '../auth';
import * as XLSX from 'xlsx';

const EVENTS_STORAGE_KEY = 'scheduler-events';
const CONTACTS_STORAGE_KEY = 'scheduler-contacts';
const COMPLETED_JOBS_STORAGE_KEY = 'scheduler-completed-jobs';
const COMPLETED_EVENT_IDS_FROM_MEETINGS_KEY = 'scheduler-completed-event-ids-meetings';
const RECENT_ACTIVITY_HIDDEN_IDS_KEY = 'scheduler-recent-hidden-ids';

function loadEventsFromStorage(): ScheduleEvent[] {
  try {
    const raw = localStorage.getItem(EVENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{ id: string; title: string; start: string; end: string; color?: ScheduleEvent['color'] }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((e) => ({
      id: e.id,
      title: e.title,
      start: new Date(e.start),
      end: new Date(e.end),
      color: e.color,
    }));
  } catch {
    return [];
  }
}

function saveEventsToStorage(events: ScheduleEvent[]) {
  try {
    const serialized = events.map((e) => ({
      id: e.id,
      title: e.title,
      start: e.start instanceof Date ? e.start.toISOString() : new Date(e.start).toISOString(),
      end: e.end instanceof Date ? e.end.toISOString() : new Date(e.end).toISOString(),
      color: e.color,
    }));
    localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(serialized));
  } catch {
    // ignore
  }
}

interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
}

function loadContactsFromStorage(): Contact[] {
  try {
    const raw = localStorage.getItem(CONTACTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c) => ({
        id: typeof c.id === 'string' ? c.id : String(Date.now()),
        name: typeof c.name === 'string' ? c.name : '',
        email: typeof c.email === 'string' ? c.email : '',
        phone: typeof c.phone === 'string' ? c.phone : '',
      }))
      .filter((c) => c.name || c.email || c.phone);
  } catch {
    return [];
  }
}

function saveContactsToStorage(contacts: Contact[]) {
  try {
    localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
  } catch {
    // ignore
  }
}

function loadCompletedEventIdsFromTracker(): string[] {
  try {
    const raw = localStorage.getItem(COMPLETED_JOBS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((job) => {
        if (!job || typeof job !== 'object') return null;
        const eventId = (job as { eventId?: unknown }).eventId;
        return typeof eventId === 'string' ? eventId : null;
      })
      .filter((id): id is string => !!id);
  } catch {
    return [];
  }
}

function loadCompletedEventIdsFromMeetings(): string[] {
  try {
    const raw = localStorage.getItem(COMPLETED_EVENT_IDS_FROM_MEETINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

function loadCompletedEventIds(): string[] {
  const fromTracker = loadCompletedEventIdsFromTracker();
  const fromMeetings = loadCompletedEventIdsFromMeetings();
  return [...new Set([...fromTracker, ...fromMeetings])];
}

function saveCompletedEventIdsFromMeetings(ids: string[]) {
  try {
    localStorage.setItem(COMPLETED_EVENT_IDS_FROM_MEETINGS_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

function removeCompletedEventIdFromTrackerStorage(eventId: string) {
  try {
    const raw = localStorage.getItem(COMPLETED_JOBS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const filtered = parsed.filter(
      (job: { eventId?: unknown }) => (job as { eventId?: string }).eventId !== eventId,
    );
    if (filtered.length === parsed.length) return;
    localStorage.setItem(COMPLETED_JOBS_STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // ignore
  }
}

interface ScheduleResponseRow {
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

interface ScheduleRequestRow {
  id: string;
  to: string;
  recipientName?: string | null;
  subject: string;
  proposedDates: string[];
  eventTitle: string | null;
  createdAt: string;
  responses: ScheduleResponseRow[];
  hourSlots?: string[];
}

interface DashboardProps {
  sideTab: SidePanelTab;
}

export function Dashboard({ sideTab }: DashboardProps) {
  const [events, setEventsState] = useState<ScheduleEvent[]>(loadEventsFromStorage);
  const [meetingsView, setMeetingsView] = useState<'list' | 'calendar'>('list');
  const [contacts, setContacts] = useState<Contact[]>(loadContactsFromStorage);

  // Merge in any events that the server already knows about (for example,
  // events created automatically when a client books a time from a shared link).
  useEffect(() => {
    fetch('/api/calendar-events')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { events?: Array<{ id: string; title: string; start: string; end: string }> } | null) => {
        if (!data || !Array.isArray(data.events)) return;
        setEventsState((prev) => {
          const byId = new Map<string, ScheduleEvent>();
          prev.forEach((e) => byId.set(e.id, e));
          data.events!.forEach((e) => {
            if (!e || !e.id || !e.start || !e.end) return;
            if (byId.has(e.id)) return;
            const start = new Date(e.start);
            const end = new Date(e.end);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
            byId.set(e.id, {
              id: e.id,
              title: e.title || 'Scheduled event',
              start,
              end,
            });
          });
          const merged = Array.from(byId.values());
          // Keep localStorage + server in sync after merging.
          saveEventsToStorage(merged);
          syncEventsToServer(merged);
          return merged;
        });
      })
      .catch(() => {
        // If the server is down, just fall back to local events.
      });
    // We only need to do this once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncEventsToServer = useCallback((eventsToSync: ScheduleEvent[]) => {
    try {
      const payload = {
        events: eventsToSync.map((e) => ({
          id: e.id,
          title: e.title,
          start: (e.start instanceof Date ? e.start : new Date(e.start)).toISOString(),
          end: (e.end instanceof Date ? e.end : new Date(e.end)).toISOString(),
        })),
      };
      // Fire-and-forget; UI does not depend on the result.
      fetch('/api/calendar-events/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {
        // ignore network errors; server sync is best-effort
      });
    } catch {
      // ignore serialization errors
    }
  }, []);

  const setEvents = useCallback((updater: ScheduleEvent[] | ((prev: ScheduleEvent[]) => ScheduleEvent[])) => {
    setEventsState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveEventsToStorage(next);
      syncEventsToServer(next);
      return next;
    });
  }, [syncEventsToServer]);

  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailModalEvent, setEmailModalEvent] = useState<ScheduleEvent | null>(null);
  const [emailModalSuggestedDate, setEmailModalSuggestedDate] = useState<Date | null>(null);
  const [scheduleRequests, setScheduleRequests] = useState<ScheduleRequestRow[]>([]);
  const [deletingRequestId, setDeletingRequestId] = useState<string | null>(null);
  const [addingResponseId, setAddingResponseId] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('09:00');
  const [editEndTime, setEditEndTime] = useState('10:00');
  const [addJobModalOpen, setAddJobModalOpen] = useState(false);
  const [createEventModalOpen, setCreateEventModalOpen] = useState(false);
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editContactName, setEditContactName] = useState('');
  const [editContactEmail, setEditContactEmail] = useState('');
  const [editContactPhone, setEditContactPhone] = useState('');
  const [deletingMeetingKey, setDeletingMeetingKey] = useState<string | null>(null);
  const [isImportingContacts, setIsImportingContacts] = useState(false);
  const contactsFileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeJobDate, setActiveJobDate] = useState<Date | null>(null);
  const [selectedMeetingsDate, setSelectedMeetingsDate] = useState<string | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<{
    request: ScheduleRequestRow;
    response: ScheduleResponseRow;
  } | null>(null);
  const [completedEventIds, setCompletedEventIds] = useState<string[]>(loadCompletedEventIds);
  const [hiddenRecentActivityIds, setHiddenRecentActivityIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(RECENT_ACTIVITY_HIDDEN_IDS_KEY);
      if (!raw) return new Set<string>();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set<string>();
      const ids = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
      return new Set<string>(ids);
    } catch {
      return new Set<string>();
    }
  });
  const [isClearRecentModalOpen, setIsClearRecentModalOpen] = useState(false);
  const completedEventIdSet = useMemo(() => new Set(completedEventIds), [completedEventIds]);

  const formatSlotLabel = (slot: string): string => {
    const h = parseInt(slot.slice(0, 2), 10);
    const next = (h + 1) % 24;
    const am = (hour: number) => (hour < 12 ? 'AM' : 'PM');
    const h12 = (hour: number) => (hour === 0 ? 12 : hour > 12 ? hour - 12 : hour);
    return `${h12(h)}:00 ${am(h)} – ${h12(next)}:00 ${am(next)}`;
  };

  const slotToEndTime = (slot: string): string => {
    const [h, m] = slot.split(':').map(Number);
    const nextH = (h + 1) % 24;
    return `${String(nextH).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;
  };

  const applyResponseToCalendar = useCallback(
    (request: ScheduleRequestRow, response: ScheduleResponseRow) => {
      const dateStr = response.selectedDate;
      const startSlot = response.selectedSlot;
      const endSlot = slotToEndTime(startSlot);
      const [startH, startM] = startSlot.split(':').map(Number);
      const [endH, endM] = endSlot.split(':').map(Number);
      const start = new Date(dateStr + 'T12:00:00');
      start.setHours(Number.isNaN(startH) ? 9 : startH, Number.isNaN(startM) ? 0 : startM, 0, 0);
      const end = new Date(dateStr + 'T12:00:00');
      end.setHours(Number.isNaN(endH) ? 10 : endH, Number.isNaN(endM) ? 0 : endM, 0, 0);
      const displayName = response.respondentName || request.recipientName || request.to;
      const eventTitle = request.eventTitle || request.subject;
      const titleWithName = displayName ? `${eventTitle} with ${displayName}` : eventTitle;
      setEvents((prev) => [
        ...prev,
        {
          id: `request-${request.id}-${dateStr}-${startSlot}`,
          title: titleWithName,
          start,
          end,
          color: 'success',
        },
      ]);
      setAddingResponseId(`${request.id}-${dateStr}-${startSlot}`);
      const confirmTo = response.respondentEmail || request.to;
      fetch('/api/send-confirmation-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: confirmTo,
          clientName: displayName,
          dateStr,
          startTime: startSlot,
          endTime: endSlot,
          eventTitle: request.eventTitle || request.subject,
          subject: request.subject,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            window.alert(`Calendar updated. Confirmation email could not be sent: ${(data as { message?: string }).message || res.status}.`);
          }
        })
        .catch(() => {
          window.alert('Calendar updated. Confirmation email could not be sent (server unreachable).');
        });
      fetch(`/api/schedule-request/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archive: true }),
      })
        .then(() => fetchScheduleRequests())
        .finally(() => setAddingResponseId(null));
    },
    [setEvents],
  );

  const fetchScheduleRequests = () => {
    fetch('/api/schedule-requests')
      .then((res) => (res.ok ? res.json() : { requests: [] }))
      .then((data: { requests: ScheduleRequestRow[] }) => setScheduleRequests(data.requests ?? []))
      .catch(() => setScheduleRequests([]));
  };

  const deleteMeeting = (req: ScheduleRequestRow, res: ScheduleResponseRow, key: string) => {
    const labelName = res.respondentName || req.recipientName || req.to || 'this client';
    const dateObj = new Date(res.selectedDate + 'T12:00:00');
    const dateLabel = Number.isNaN(dateObj.getTime())
      ? res.selectedDate
      : format(dateObj, 'EEE, MMM d');
    const slotLabel = formatSlotLabel(res.selectedSlot);
    const message = `Delete this meeting with ${labelName}?\n${dateLabel} • ${slotLabel}`;
    if (!window.confirm(message)) return;

    setDeletingMeetingKey(key);

    // Remove the corresponding calendar event (added automatically when the client booked).
    const eventId = `request-${req.id}-${res.selectedDate}-${res.selectedSlot}`;
    setEvents((prev) => prev.filter((e) => e.id !== eventId));

    fetch(`/api/schedule-request/${req.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        removeResponse: {
          selectedDate: res.selectedDate,
          selectedSlot: res.selectedSlot,
        },
      }),
    })
      .then(async (response) => {
        if (response.ok) {
          fetchScheduleRequests();
          return;
        }
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        window.alert(
          body?.message ||
            `Delete failed (${response.status}). Is the server running? Run \`npm run server\` in a separate terminal.`,
        );
      })
      .catch(() => {
        window.alert('Could not reach the server. Run `npm run server` in a separate terminal.');
      })
      .finally(() => {
        setDeletingMeetingKey(null);
      });
  };

  const completeMeetingJob = (eventId: string) => {
    const fromMeetings = loadCompletedEventIdsFromMeetings();
    if (fromMeetings.includes(eventId)) return;
    saveCompletedEventIdsFromMeetings([...fromMeetings, eventId]);
    setCompletedEventIds(loadCompletedEventIds());
  };

  const uncompleteMeetingJob = (eventId: string) => {
    const fromMeetings = loadCompletedEventIdsFromMeetings().filter((id) => id !== eventId);
    saveCompletedEventIdsFromMeetings(fromMeetings);
    removeCompletedEventIdFromTrackerStorage(eventId);
    setCompletedEventIds(loadCompletedEventIds());
  };

  const deleteScheduleRequest = (req: ScheduleRequestRow) => {
    const message = `Remove this schedule request${req.responses?.length ? ` (${req.responses.length} response(s))` : ''}?\n${req.eventTitle || req.subject}`;
    if (!window.confirm(message)) return;
    setDeletingRequestId(req.id);
    fetch(`/api/schedule-request/${req.id}`, { method: 'DELETE' })
      .then(async (res) => {
        if (res.ok) {
          fetchScheduleRequests();
          return;
        }
        const body = await res.json().catch(() => ({})) as { message?: string };
        window.alert(body?.message || `Delete failed (${res.status}). Is the server running? Run \`npm run server\` in a separate terminal.`);
      })
      .catch(() => {
        window.alert('Could not reach the server. Run `npm run server` in a separate terminal.');
      })
      .finally(() => setDeletingRequestId(null));
  };

  const deleteEvent = (evt: ScheduleEvent) => {
    if (!window.confirm(`Delete "${evt.title}"?`)) return;
    setEvents((prev) => prev.filter((e) => e.id !== evt.id));
  };

  const beginEditEvent = (evt: ScheduleEvent) => {
    setEditingEvent(evt);
    const start = evt.start instanceof Date ? evt.start : new Date(evt.start);
    const end = evt.end instanceof Date ? evt.end : new Date(evt.end);
    setEditDate(format(start, 'yyyy-MM-dd'));
    setEditStartTime(format(start, 'HH:mm'));
    setEditEndTime(format(end, 'HH:mm'));
  };

  const applyEditEvent = () => {
    if (!editingEvent || !editDate) {
      setEditingEvent(null);
      return;
    }
    const [startH, startM] = editStartTime.split(':').map(Number);
    const [endH, endM] = editEndTime.split(':').map(Number);
    const base = new Date(editDate + 'T12:00:00');
    const newStart = new Date(base);
    newStart.setHours(Number.isNaN(startH) ? 9 : startH, Number.isNaN(startM) ? 0 : startM, 0, 0);
    const newEnd = new Date(base);
    newEnd.setHours(Number.isNaN(endH) ? 10 : endH, Number.isNaN(endM) ? 0 : endM, 0, 0);
    setEvents((prev) =>
      prev.map((e) =>
        e.id === editingEvent.id
          ? {
              ...e,
              start: newStart,
              end: newEnd,
            }
          : e
      )
    );
    setEditingEvent(null);
  };

  useEffect(() => {
    fetchScheduleRequests();
  }, []);

  // On initial load, push any existing events (from localStorage) up to the server
  // so respond links know about everything already on the calendar.
  useEffect(() => {
    if (events.length > 0) {
      syncEventsToServer(events);
    }
    // We only need to run this once on mount with the initial events snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEmailModal = (opts?: { event?: ScheduleEvent; suggestedDate?: Date }) => {
    setEmailModalEvent(opts?.event ?? null);
    setEmailModalSuggestedDate(opts?.suggestedDate ?? null);
    setEmailModalOpen(true);
  };

  const handleAddContact = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newContactName.trim();
    const trimmedEmail = newContactEmail.trim();
    const trimmedPhone = newContactPhone.trim();
    if (!trimmedName && !trimmedEmail && !trimmedPhone) {
      return;
    }
    const next: Contact = {
      id: `contact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmedName || trimmedEmail || trimmedPhone,
      email: trimmedEmail,
      phone: trimmedPhone,
    };
    setContacts((prev) => {
      const updated = [...prev, next];
      saveContactsToStorage(updated);
      return updated;
    });
    setNewContactName('');
    setNewContactEmail('');
    setNewContactPhone('');
    setIsAddingContact(false);
  };

  const handleDeleteContact = (contact: Contact) => {
    if (!window.confirm(`Remove contact "${contact.name || contact.email || contact.phone}"?`)) return;
    setContacts((prev) => {
      const updated = prev.filter((c) => c.id !== contact.id);
      saveContactsToStorage(updated);
      return updated;
    });
  };

  const beginEditContact = (contact: Contact) => {
    setIsAddingContact(false);
    setEditingContactId(contact.id);
    setEditContactName(contact.name);
    setEditContactEmail(contact.email);
    setEditContactPhone(contact.phone);
  };

  const cancelEditContact = () => {
    setEditingContactId(null);
    setEditContactName('');
    setEditContactEmail('');
    setEditContactPhone('');
  };

  const applyEditContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContactId) return;
    const trimmedName = editContactName.trim();
    const trimmedEmail = editContactEmail.trim();
    const trimmedPhone = editContactPhone.trim();
    if (!trimmedName && !trimmedEmail && !trimmedPhone) {
      // Do not allow blank contact; keep editing.
      return;
    }
    setContacts((prev) => {
      const updated = prev.map((c) =>
        c.id === editingContactId
          ? {
              ...c,
              name: trimmedName || trimmedEmail || trimmedPhone,
              email: trimmedEmail,
              phone: trimmedPhone,
            }
          : c,
      );
      saveContactsToStorage(updated);
      return updated;
    });
    cancelEditContact();
  };

  const importContactsFromRows = (rows: Array<Record<string, unknown>>) => {
    if (!rows || rows.length === 0) return;

    setContacts((prev) => {
      const existingKeys = new Set<string>();
      prev.forEach((c) => {
        const key = (c.email || c.phone || c.name || '').toLowerCase().trim();
        if (key) existingKeys.add(key);
      });

      const next = [...prev];
      let addedCount = 0;

      rows.forEach((row) => {
        if (!row || typeof row !== 'object') return;

        let name = '';
        let email = '';
        let phone = '';

        Object.entries(row).forEach(([header, value]) => {
          const normalizedHeader = String(header).toLowerCase().trim();
          const textValue =
            typeof value === 'string' || typeof value === 'number'
              ? String(value).trim()
              : '';
          if (!textValue) return;

          if (!email && (normalizedHeader.includes('mail') || normalizedHeader === 'email')) {
            email = textValue;
            return;
          }
          if (
            !phone &&
            (normalizedHeader.includes('phone') ||
              normalizedHeader.includes('mobile') ||
              normalizedHeader.includes('cell') ||
              normalizedHeader === 'tel')
          ) {
            phone = textValue;
            return;
          }
          if (!name && normalizedHeader.includes('name')) {
            name = textValue;
          }
        });

        if (!name && (email || phone)) {
          name = email || phone;
        }

        if (!name && !email && !phone) return;

        const key = (email || phone || name).toLowerCase().trim();
        if (!key || existingKeys.has(key)) return;

        const contact: Contact = {
          id: `contact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          email,
          phone,
        };

        next.push(contact);
        existingKeys.add(key);
        addedCount += 1;
      });

      if (addedCount > 0) {
        saveContactsToStorage(next);
        window.alert(`Imported ${addedCount} contact${addedCount === 1 ? '' : 's'} from file.`);
        return next;
      }

      window.alert('No new contacts were imported (sheet may be empty or all contacts already exist).');
      return prev;
    });
  };

  const handleImportContactsFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImportingContacts(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          throw new Error('Could not read file contents.');
        }

        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          throw new Error('No sheets found in file.');
        }
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: '',
        });
        importContactsFromRows(rows);
      } catch (err) {
        const message =
          err && typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string'
            ? (err as any).message
            : 'Unknown error while importing contacts.';
        window.alert(`Could not import contacts: ${message}`);
      } finally {
        setIsImportingContacts(false);
        event.target.value = '';
      }
    };
    reader.onerror = () => {
      window.alert('Could not read file. Please try again with a valid Excel or CSV file.');
      setIsImportingContacts(false);
      event.target.value = '';
    };

    reader.readAsArrayBuffer(file);
  };

  const handleImportContactsClick = () => {
    cancelEditContact();
    setIsAddingContact(false);
    contactsFileInputRef.current?.click();
  };

  const scheduleEmailRequests = useMemo(
    () => scheduleRequests.filter((req) => !!(req.to && req.to.trim())),
    [scheduleRequests],
  );

  const eventLinkRequests = useMemo(
    () => scheduleRequests.filter((req) => !req.to || !req.to.trim()),
    [scheduleRequests],
  );

  // Meetings are individual responses to event-link requests:
  // each client who books a time via a shared link becomes one row.
  const meetingRows = useMemo(
    () =>
      eventLinkRequests
        .flatMap((req) =>
          (req.responses ?? []).map((r) => ({
            request: req,
            response: r,
          })),
        )
        .sort((a, b) => {
          const aDate = new Date(a.response.selectedDate + 'T12:00:00');
          const bDate = new Date(b.response.selectedDate + 'T12:00:00');
          if (aDate.getTime() !== bDate.getTime()) {
            return aDate.getTime() - bDate.getTime();
          }
          return a.response.selectedSlot.localeCompare(b.response.selectedSlot);
        }),
    [eventLinkRequests],
  );

  // Group meetings by day so they are visually separated instead of all clumped.
  const meetingGroups = useMemo(() => {
    const groups: Record<string, typeof meetingRows> = {};
    meetingRows.forEach((row) => {
      const key = row.response.selectedDate;
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    });
    return groups;
  }, [meetingRows]);

  // Automatically create/augment contacts from booked meetings so you don't
  // have to re-enter client info manually.
  useEffect(() => {
    setContacts((prev) => {
      const existingKeys = new Set<string>();
      prev.forEach((c) => {
        const key = (c.email || c.phone || c.name || '').toLowerCase();
        if (key) existingKeys.add(key);
      });

      let changed = false;
      const next = [...prev];

      meetingRows.forEach(({ response }) => {
        const name = (response.respondentName || '').trim();
        const email = (response.respondentEmail || '').trim();
        const phone = (response.respondentPhone || '').trim();
        const key = (email || phone || name).toLowerCase();
        if (!key || existingKeys.has(key)) return;

        const contact: Contact = {
          id: `contact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: name || email || phone,
          email,
          phone,
        };

        next.push(contact);
        existingKeys.add(key);
        changed = true;
      });

      if (changed) {
        saveContactsToStorage(next);
        return next;
      }
      return prev;
    });
  }, [meetingRows]);

  useEffect(() => {
    if (meetingsView !== 'calendar') {
      setSelectedMeetingsDate(null);
    }
  }, [meetingsView]);

  useEffect(() => {
    if (
      selectedMeetingsDate &&
      !(meetingGroups[selectedMeetingsDate] && meetingGroups[selectedMeetingsDate].length > 0)
    ) {
      setSelectedMeetingsDate(null);
    }
  }, [selectedMeetingsDate, meetingGroups]);

  const parseEventTitle = (req: ScheduleRequestRow): { title: string; workType: string | null } => {
    const full = (req.eventTitle || req.subject || '').trim();
    if (!full) return { title: 'Untitled event', workType: null };
    const openIdx = full.lastIndexOf('(');
    const closeIdx = full.lastIndexOf(')');
    if (openIdx > 0 && closeIdx > openIdx) {
      const base = full.slice(0, openIdx).trim();
      const inner = full.slice(openIdx + 1, closeIdx).trim();
      return { title: base || full, workType: inner || null };
    }
    return { title: full, workType: null };
  };

  const formatEventDatesSummary = (dates: string[]): string => {
    if (!dates || dates.length === 0) return 'No dates selected';
    const parts = dates
      .slice()
      .sort()
      .map((d) => {
        const dt = new Date(`${d}T12:00:00`);
        if (Number.isNaN(dt.getTime())) return null;
        return format(dt, 'EEE, MMM d');
      })
      .filter((v): v is string => !!v);
    if (parts.length === 0) return 'No dates selected';
    const maxShown = 3;
    const shown = parts.slice(0, maxShown);
    const remaining = parts.length - shown.length;
    if (remaining > 0) {
      return `Dates: ${shown.join(', ')} +${remaining} more`;
    }
    return `Dates: ${shown.join(', ')}`;
  };

  const formatEventTimeWindow = (hourSlots?: string[]): string => {
    const slots = hourSlots && hourSlots.length > 0 ? hourSlots.slice().sort() : null;
    const startSlot = slots?.[0] ?? '09:00';
    const lastSlot = slots?.[slots.length - 1] ?? '16:00';
    const windowStartLabel = formatSlotLabel(startSlot).split(' – ')[0];
    const windowEndLabel = formatSlotLabel(slotToEndTime(lastSlot)).split(' – ')[1];
    return `Time window: ${windowStartLabel} – ${windowEndLabel}`;
  };

  const buildRespondLink = (id: string): string => {
    try {
      const origin = window.location.origin || '';
      const url = new URL(`/respond/${id}`, origin);
      return url.toString();
    } catch {
      return `/respond/${id}`;
    }
  };

  const isDashboardTab = sideTab === 'dashboard';
  const isEventsTab = sideTab === 'events';
  const isMeetingsTab = sideTab === 'meetings';
  const isContactsTab = sideTab === 'contacts';
  const isTrackerTab = sideTab === 'tracker';
  const isSettingsTab = sideTab === 'settings';

  const [settingsUsers, setSettingsUsers] = useState<auth.User[]>(() => auth.getUsers());
  const [newUserUsername, setNewUserUsername] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [settingsUserError, setSettingsUserError] = useState('');

  const refreshSettingsUsers = useCallback(() => {
    setSettingsUsers(auth.getUsers());
  }, []);

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsUserError('');
    const trimmed = newUserUsername.trim();
    if (!trimmed || !newUserPassword) {
      setSettingsUserError('Username and password are required.');
      return;
    }
    if (auth.addUser(trimmed, newUserPassword)) {
      setNewUserUsername('');
      setNewUserPassword('');
      refreshSettingsUsers();
    } else {
      setSettingsUserError('A user with that username already exists.');
    }
  };

  const resetRecentActivity = () => {
    if (events.length === 0) return;
    setIsClearRecentModalOpen(true);
  };

  const confirmClearRecentActivity = () => {
    const nextHidden = new Set<string>(hiddenRecentActivityIds);
    events.forEach((evt) => {
      if (evt && typeof evt.id === 'string' && evt.id.length > 0) {
        nextHidden.add(evt.id);
      }
    });
    setHiddenRecentActivityIds(nextHidden);
    try {
      localStorage.setItem(RECENT_ACTIVITY_HIDDEN_IDS_KEY, JSON.stringify(Array.from(nextHidden)));
    } catch {
      // ignore
    }
    setIsClearRecentModalOpen(false);
  };

  const cancelClearRecentActivity = () => {
    setIsClearRecentModalOpen(false);
  };

  const recentEvents = useMemo(
    () => {
      const visibleEvents = events.filter(
        (evt) => !(evt && typeof evt.id === 'string' && hiddenRecentActivityIds.has(evt.id)),
      );

      return [...visibleEvents]
        .sort(
          (a, b) =>
            (b.start instanceof Date ? b.start : new Date(b.start)).getTime() -
            (a.start instanceof Date ? a.start : new Date(a.start)).getTime(),
        )
        .slice(0, 30);
    },
    [events, hiddenRecentActivityIds],
  );

  const meetingEvents = useMemo<ScheduleEvent[]>(
    () =>
      meetingRows.map(({ request, response }, idx) => {
        const dateStr = response.selectedDate;
        const startSlot = response.selectedSlot;
        const endSlot = slotToEndTime(startSlot);
        const [startH, startM] = startSlot.split(':').map(Number);
        const [endH, endM] = endSlot.split(':').map(Number);
        const base = new Date(dateStr + 'T12:00:00');
        const start = new Date(base);
        start.setHours(Number.isNaN(startH) ? 9 : startH, Number.isNaN(startM) ? 0 : startM, 0, 0);
        const end = new Date(base);
        end.setHours(Number.isNaN(endH) ? 10 : endH, Number.isNaN(endM) ? 0 : endM, 0, 0);
        const { title } = parseEventTitle(request);
        const displayName = response.respondentName || 'Client';
        // Use the same event id pattern as the main calendar so tracker views
        // and the calendar stay in sync and deduplicate correctly.
        const id = `request-${request.id}-${response.selectedDate}-${response.selectedSlot}`;
        return {
          id,
          title: `${title} with ${displayName}`,
          start,
          end,
          color: 'success',
        };
      }),
    [meetingRows],
  );

  const trackerEvents = useMemo<ScheduleEvent[]>(
    () => {
      const byId = new Map<string, ScheduleEvent>();
      events.forEach((evt) => {
        if (evt && evt.id) {
          byId.set(evt.id, evt);
        }
      });
      meetingEvents.forEach((evt) => {
        if (evt && evt.id && !byId.has(evt.id)) {
          byId.set(evt.id, evt);
        }
      });
      return Array.from(byId.values());
    },
    [events, meetingEvents],
  );

  const selectedDateEvents =
    selectedDate != null
      ? [...events, ...meetingEvents]
          .filter((e) =>
            isSameDay(
              e.start instanceof Date ? e.start : new Date(e.start),
              selectedDate,
            ),
          )
          .sort(
            (a, b) =>
              (a.start instanceof Date ? a.start : new Date(a.start)).getTime() -
              (b.start instanceof Date ? b.start : new Date(b.start)).getTime(),
          )
      : [];

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">
            {sideTab === 'dashboard' && 'Dashboard'}
            {sideTab === 'events' && 'Events'}
            {sideTab === 'meetings' && 'Meetings'}
            {sideTab === 'tracker' && 'Schedule'}
            {sideTab === 'contacts' && 'Contacts'}
            {sideTab === 'settings' && 'Settings'}
          </h1>
          <p className="dashboard-subtitle">
            {format(new Date(), 'EEEE, MMMM d')}
          </p>
        </div>
        <div className="dashboard-header-actions">
          <button
            type="button"
            className="dashboard-cta"
            onClick={() => setAddJobModalOpen(true)}
          >
            New event
          </button>
          <button
            type="button"
            className="dashboard-cta secondary"
            onClick={() => openEmailModal()}
          >
            Email to schedule
          </button>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-main">
          {isDashboardTab && (
            <div className="dashboard-card">
              <div className="dashboard-card-header">
                <h3 className="dashboard-card-title">Recent activity</h3>
                {recentEvents.length > 0 && (
                  <button
                    type="button"
                    className="dashboard-card-add-btn"
                    onClick={resetRecentActivity}
                  >
                    Clear
                  </button>
                )}
              </div>
              {recentEvents.length === 0 ? (
                <p className="dashboard-empty">No events yet</p>
              ) : (
                <ul className="event-list">
                  {recentEvents.map((evt) => (
                    <li key={evt.id} className={`event-item ${evt.color || 'default'}`}>
                      <div className="event-item-content">
                        <span className="event-time">
                          {format(
                            evt.start instanceof Date ? evt.start : new Date(evt.start),
                            'EEE, MMM d • h:mm a',
                          )}
                        </span>
                        <span className="event-title">{evt.title}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {isSettingsTab && (
            <div className="dashboard-card">
              <div className="dashboard-card-header">
                <h3 className="dashboard-card-title">Users</h3>
              </div>
              <p className="dashboard-empty" style={{ marginBottom: 16 }}>
                Manage users who can sign in to the scheduler.
              </p>
              <ul className="settings-users-list">
                {settingsUsers.map((u) => (
                  <li key={u.username} className="settings-user-row">
                    <span className="settings-user-name">{u.username}</span>
                  </li>
                ))}
              </ul>
              <form className="settings-add-user-form" onSubmit={handleAddUser}>
                <h4 className="settings-form-title">Add user</h4>
                {settingsUserError && (
                  <p className="settings-form-error" role="alert">
                    {settingsUserError}
                  </p>
                )}
                <div className="settings-form-row">
                  <label className="settings-label" style={{ flex: 1 }}>
                    Username
                    <input
                      type="text"
                      className="settings-input"
                      value={newUserUsername}
                      onChange={(e) => setNewUserUsername(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <label className="settings-label" style={{ flex: 1 }}>
                    Password
                    <input
                      type="password"
                      className="settings-input"
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </label>
                </div>
                <button type="submit" className="dashboard-card-add-btn" style={{ alignSelf: 'flex-start' }}>
                  Add user
                </button>
              </form>
            </div>
          )}
          {!isDashboardTab && !isEventsTab && !isMeetingsTab && !isContactsTab && !isSettingsTab && (
            <Calendar
              events={isTrackerTab ? trackerEvents : events}
              onSelectDate={setSelectedDate}
              selectedDate={selectedDate}
              highlightDates={isTrackerTab && activeJobDate ? [activeJobDate] : undefined}
            />
          )}
          {isEventsTab && (
            <div className="dashboard-card">
              <div className="dashboard-card-header">
                <h3 className="dashboard-card-title">Event types</h3>
                <div className="dashboard-card-actions">
                  <button
                    type="button"
                    className="dashboard-card-add-btn"
                    onClick={() => setCreateEventModalOpen(true)}
                  >
                    New event type
                  </button>
                </div>
              </div>
              {eventLinkRequests.length === 0 ? (
                <p className="dashboard-empty">No events created yet</p>
              ) : (
                <ul className="schedule-requests-list">
                  {eventLinkRequests.map((req) => {
                    const link = buildRespondLink(req.id);
                    const responsesCount = req.responses?.length ?? 0;
                    const { title, workType } = parseEventTitle(req);
                    const datesSummary = formatEventDatesSummary(req.proposedDates || []);
                    const timeWindow = formatEventTimeWindow(req.hourSlots);
                    return (
                      <li
                        key={req.id}
                        className="schedule-request-item responded"
                      >
                        <div className="schedule-request-content">
                          <span className="schedule-request-subject">
                            {title}
                          </span>
                          {workType && (
                            <span className="schedule-request-work-type">
                              {workType}
                            </span>
                          )}
                          <span className="schedule-request-dates">
                            {datesSummary}
                          </span>
                          <span className="schedule-request-time-window">
                            {timeWindow}
                          </span>
                          {responsesCount > 0 && (
                            <span className="schedule-request-responses-count">
                              {responsesCount} response
                              {responsesCount !== 1 ? 's' : ''} so far
                            </span>
                          )}
                        </div>
                        <div className="schedule-request-item-actions">
                          <button
                            type="button"
                            className="schedule-request-pick-btn"
                            onClick={() => {
                              if (navigator.clipboard) {
                                navigator.clipboard.writeText(link).catch(() => {
                                  // ignore
                                });
                              }
                            }}
                          >
                            Copy link
                          </button>
                          <button
                            type="button"
                            className="schedule-request-delete-btn"
                            onClick={() => deleteScheduleRequest(req)}
                            disabled={deletingRequestId === req.id}
                          >
                            {deletingRequestId === req.id ? '…' : 'Delete'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {isMeetingsTab && (
            <div className="dashboard-card">
              <h3 className="dashboard-card-title">Meetings</h3>
              {meetingRows.length === 0 ? (
                <p className="dashboard-empty">No meetings scheduled yet.</p>
              ) : (
                <>
                  <div className="meetings-view-toggle" aria-label="Meetings view">
                    <button
                      type="button"
                      className={`meetings-view-btn ${meetingsView === 'list' ? 'active' : ''}`}
                      onClick={() => setMeetingsView('list')}
                    >
                      List
                    </button>
                    <button
                      type="button"
                      className={`meetings-view-btn ${meetingsView === 'calendar' ? 'active' : ''}`}
                      onClick={() => setMeetingsView('calendar')}
                    >
                      Calendar
                    </button>
                  </div>
                  {meetingsView === 'calendar' ? (
                    <div className="meetings-calendar-wrapper">
                      <Calendar
                        events={meetingEvents}
                        onSelectDate={(date) => {
                          const iso = format(date, 'yyyy-MM-dd');
                          const rows = meetingGroups[iso] ?? [];
                          setSelectedMeetingsDate(rows.length > 0 ? iso : null);
                        }}
                        selectedDate={
                          selectedMeetingsDate
                            ? new Date(selectedMeetingsDate + 'T12:00:00')
                            : null
                        }
                      />
                      {selectedMeetingsDate &&
                        meetingGroups[selectedMeetingsDate] &&
                        meetingGroups[selectedMeetingsDate].length > 0 && (
                          <div className="schedule-list">
                            {(() => {
                              const dateKey = selectedMeetingsDate;
                              const date = new Date(dateKey + 'T12:00:00');
                              const dateLabel = format(date, 'EEEE, MMMM d');
                              const rows = meetingGroups[dateKey];
                              return (
                                <section key={dateKey} className="schedule-day-group">
                                  <h4 className="schedule-day-header">{dateLabel}</h4>
                                  <div className="schedule-day-cards">
                                    {rows.map(({ request, response }, idx) => {
                                      const { title } = parseEventTitle(request);
                                      const slotLabel = formatSlotLabel(response.selectedSlot);
                                      const displayName = response.respondentName || 'Client';
                                      const emailLabel = response.respondentEmail || '';
                                      const phoneLabel = response.respondentPhone || '';
                                      const notes = response.respondentNotes || '';
                                      const addressParts = [
                                        response.respondentStreet || '',
                                        response.respondentAddress2 || '',
                                        response.respondentCity || '',
                                        response.respondentState || '',
                                        response.respondentPostalCode || '',
                                      ]
                                        .map((part) => part.trim())
                                        .filter((part) => part.length > 0);
                                      const addressLabel = addressParts.join(' • ');
                                      const eventId = `request-${request.id}-${response.selectedDate}-${response.selectedSlot}`;
                                      const isCompleted = completedEventIdSet.has(eventId);
                                      const key = `${request.id}-${response.selectedDate}-${response.selectedSlot}-${idx}`;
                                      return (
                                        <article
                                          key={key}
                                          className="schedule-job-card schedule-job-card--clickable"
                                          onClick={() => setSelectedMeeting({ request, response })}
                                          role="button"
                                          tabIndex={0}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                              e.preventDefault();
                                              setSelectedMeeting({ request, response });
                                            }
                                          }}
                                          aria-label={`View details for ${title} with ${displayName}`}
                                        >
                                          <div className="schedule-job-main">
                                            <div className="schedule-job-title-row">
                                              <span className="schedule-job-title">
                                                {title}
                                              </span>
                                            </div>
                                            <p className="schedule-job-client">{displayName}</p>
                                            <p className="schedule-job-time">{slotLabel}</p>
                                            {emailLabel && (
                                              <p className="schedule-job-time">{emailLabel}</p>
                                            )}
                                            {phoneLabel && (
                                              <p className="schedule-job-time">{phoneLabel}</p>
                                            )}
                                            {addressLabel && (
                                              <p className="schedule-job-time">{addressLabel}</p>
                                            )}
                                            {isCompleted && (
                                              <p className="schedule-job-status">Completed</p>
                                            )}
                                          </div>
                                          <div className="schedule-job-notes">
                                            {notes && (
                                              <>
                                                <span className="schedule-job-notes-label">Notes</span>
                                                <p className="schedule-job-notes-text">
                                                  {notes}
                                                </p>
                                              </>
                                            )}
                                            <div className="schedule-job-actions">
                                              {isCompleted ? (
                                                <button
                                                  type="button"
                                                  className="schedule-job-uncomplete-btn"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    uncompleteMeetingJob(eventId);
                                                  }}
                                                >
                                                  Uncomplete
                                                </button>
                                              ) : (
                                                <button
                                                  type="button"
                                                  className="schedule-job-complete-btn"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    completeMeetingJob(eventId);
                                                  }}
                                                >
                                                  Complete
                                                </button>
                                              )}
                                              <button
                                                type="button"
                                                className="schedule-job-delete-btn"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  deleteMeeting(request, response, key);
                                                }}
                                                disabled={deletingMeetingKey === key}
                                              >
                                                {deletingMeetingKey === key ? 'Deleting…' : 'Delete'}
                                              </button>
                                            </div>
                                          </div>
                                        </article>
                                      );
                                    })}
                                  </div>
                                </section>
                              );
                            })()}
                          </div>
                        )}
                    </div>
                  ) : (
                    <div className="schedule-list">
                      {Object.keys(meetingGroups)
                        .sort()
                        .map((dateKey) => {
                          const date = new Date(dateKey + 'T12:00:00');
                          const dateLabel = format(date, 'EEEE, MMMM d');
                          const rows = meetingGroups[dateKey];
                          return (
                            <section key={dateKey} className="schedule-day-group">
                              <h4 className="schedule-day-header">{dateLabel}</h4>
                              <div className="schedule-day-cards">
                                {rows.map(({ request, response }, idx) => {
                                  const { title } = parseEventTitle(request);
                                  const slotLabel = formatSlotLabel(response.selectedSlot);
                                  const displayName = response.respondentName || 'Client';
                                  const emailLabel = response.respondentEmail || '';
                                  const phoneLabel = response.respondentPhone || '';
                                  const notes = response.respondentNotes || '';
                                  const addressParts = [
                                    response.respondentStreet || '',
                                    response.respondentAddress2 || '',
                                    response.respondentCity || '',
                                    response.respondentState || '',
                                    response.respondentPostalCode || '',
                                  ]
                                    .map((part) => part.trim())
                                    .filter((part) => part.length > 0);
                                  const addressLabel = addressParts.join(' • ');
                                  const eventId = `request-${request.id}-${response.selectedDate}-${response.selectedSlot}`;
                                  const isCompleted = completedEventIdSet.has(eventId);
                                  const key = `${request.id}-${response.selectedDate}-${response.selectedSlot}-${idx}`;
                                  return (
                                    <article
                                      key={key}
                                      className="schedule-job-card schedule-job-card--clickable"
                                      onClick={() => setSelectedMeeting({ request, response })}
                                      role="button"
                                      tabIndex={0}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          setSelectedMeeting({ request, response });
                                        }
                                      }}
                                      aria-label={`View details for ${title} with ${displayName}`}
                                    >
                                      <div className="schedule-job-main">
                                        <div className="schedule-job-title-row">
                                          <span className="schedule-job-title">
                                            {title}
                                          </span>
                                        </div>
                                        <p className="schedule-job-client">{displayName}</p>
                                        <p className="schedule-job-time">{slotLabel}</p>
                                        {emailLabel && (
                                          <p className="schedule-job-time">{emailLabel}</p>
                                        )}
                                        {phoneLabel && (
                                          <p className="schedule-job-time">{phoneLabel}</p>
                                        )}
                                        {addressLabel && (
                                          <p className="schedule-job-time">{addressLabel}</p>
                                        )}
                                        {isCompleted && (
                                          <p className="schedule-job-status">Completed</p>
                                        )}
                                      </div>
                                        <div className="schedule-job-notes">
                                          {notes && (
                                            <>
                                              <span className="schedule-job-notes-label">Notes</span>
                                              <p className="schedule-job-notes-text">
                                                {notes}
                                              </p>
                                            </>
                                          )}
                                          <div className="schedule-job-actions">
                                            {isCompleted ? (
                                              <button
                                                type="button"
                                                className="schedule-job-uncomplete-btn"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  uncompleteMeetingJob(eventId);
                                                }}
                                              >
                                                Uncomplete
                                              </button>
                                            ) : (
                                              <button
                                                type="button"
                                                className="schedule-job-complete-btn"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  completeMeetingJob(eventId);
                                                }}
                                              >
                                                Complete
                                              </button>
                                            )}
                                            <button
                                              type="button"
                                              className="schedule-job-delete-btn"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                deleteMeeting(request, response, key);
                                              }}
                                              disabled={deletingMeetingKey === key}
                                            >
                                              {deletingMeetingKey === key ? 'Deleting…' : 'Delete'}
                                            </button>
                                          </div>
                                        </div>
                                      </article>
                                    );
                                  })}
                                </div>
                              </section>
                            );
                          })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {isContactsTab && (
            <div className="dashboard-card">
              <div className="dashboard-card-header">
                <h3 className="dashboard-card-title">Contacts</h3>
              </div>
              <input
                ref={contactsFileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={handleImportContactsFileChange}
              />
              <div className="contacts-table">
                <div className="contacts-header-row">
                  <span className="contacts-header-cell">Name</span>
                  <span className="contacts-header-cell">Email</span>
                  <span className="contacts-header-cell">Phone number</span>
                </div>
                {contacts.length === 0 && !isAddingContact && (
                  <div className="contacts-empty">
                    No contacts yet.
                  </div>
                )}
                {contacts.length > 0 && (
                  <ul className="contacts-rows">
                    {contacts.map((contact) => (
                      <li key={contact.id} className="contacts-row">
                        <>
                          <span className="contacts-cell">{contact.name}</span>
                          <span className="contacts-cell">{contact.email}</span>
                          <span className="contacts-cell contacts-cell-actions">
                            <span className="contacts-phone">{contact.phone}</span>
                            <div className="contacts-actions-buttons">
                              <button
                                type="button"
                                className="contacts-edit-btn"
                                onClick={() => beginEditContact(contact)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="contacts-delete-btn"
                                onClick={() => handleDeleteContact(contact)}
                              >
                                Delete
                              </button>
                            </div>
                          </span>
                        </>
                      </li>
                    ))}
                  </ul>
                )}
                {isAddingContact && (
                  <form className="contacts-form" onSubmit={handleAddContact}>
                    <input
                      type="text"
                      className="contacts-input"
                      placeholder="Name"
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                    />
                    <input
                      type="email"
                      className="contacts-input"
                      placeholder="Email"
                      value={newContactEmail}
                      onChange={(e) => setNewContactEmail(e.target.value)}
                    />
                    <input
                      type="tel"
                      className="contacts-input"
                      placeholder="Phone"
                      value={newContactPhone}
                      onChange={(e) => setNewContactPhone(e.target.value)}
                    />
                    <div className="contacts-form-actions">
                      <button
                        type="button"
                        className="contacts-cancel-btn"
                        onClick={() => {
                          setIsAddingContact(false);
                          setNewContactName('');
                          setNewContactEmail('');
                          setNewContactPhone('');
                        }}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="contacts-save-btn">
                        Save
                      </button>
                    </div>
                  </form>
                )}
                {!isAddingContact && editingContactId && (
                  <form className="contacts-form" onSubmit={applyEditContact}>
                    <input
                      type="text"
                      className="contacts-input"
                      placeholder="Name"
                      value={editContactName}
                      onChange={(e) => setEditContactName(e.target.value)}
                    />
                    <input
                      type="email"
                      className="contacts-input"
                      placeholder="Email"
                      value={editContactEmail}
                      onChange={(e) => setEditContactEmail(e.target.value)}
                    />
                    <input
                      type="tel"
                      className="contacts-input"
                      placeholder="Phone"
                      value={editContactPhone}
                      onChange={(e) => setEditContactPhone(e.target.value)}
                    />
                    <div className="contacts-form-actions">
                      <button
                        type="button"
                        className="contacts-cancel-btn"
                        onClick={cancelEditContact}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="contacts-save-btn">
                        Save
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </section>
        <aside className="dashboard-side">
          {isContactsTab && (
            <div className="contacts-side-actions">
              <button
                type="button"
                className="dashboard-card-add-btn"
                onClick={() => {
                  cancelEditContact();
                  setIsAddingContact(true);
                }}
              >
                Add contact
              </button>
              <button
                type="button"
                className="dashboard-card-add-btn"
                onClick={handleImportContactsClick}
                disabled={isImportingContacts}
              >
                {isImportingContacts ? 'Importing…' : 'Import from file'}
              </button>
            </div>
          )}
          {isTrackerTab && (
            <TimeTracker
              events={trackerEvents}
              onActiveJobChange={(evt) => {
                if (!evt) {
                  setActiveJobDate(null);
                  return;
                }
                const start = evt.start instanceof Date ? evt.start : new Date(evt.start);
                setActiveJobDate(start);
              }}
              onCompleteEvent={(eventId) => {
                // When a job is completed in the time tracker, remove it from the main
                // events collection so the calendar view no longer shows it, and
                // mark it as completed so the meetings tab can reflect that state.
                setEvents((prev) => prev.filter((evt) => evt.id !== eventId));
                setCompletedEventIds((prev) =>
                  prev.includes(eventId) ? prev : [...prev, eventId],
                );
              }}
            />
          )}
        </aside>
      </div>

      <JobDetailsModal
        isOpen={selectedDate != null}
        date={selectedDate}
        events={selectedDateEvents}
        onClose={() => setSelectedDate(null)}
        onEmail={(evt) => openEmailModal({ event: evt })}
        onDelete={deleteEvent}
      />
      <MeetingDetailModal
        isOpen={selectedMeeting != null}
        request={selectedMeeting?.request ?? null}
        response={selectedMeeting?.response ?? null}
        onClose={() => setSelectedMeeting(null)}
      />

      <EmailScheduleModal
        key={emailModalOpen ? `${emailModalEvent?.id ?? 'none'}-${emailModalSuggestedDate?.getTime() ?? 'none'}` : 'closed'}
        isOpen={emailModalOpen}
        onClose={() => {
          setEmailModalOpen(false);
          fetchScheduleRequests();
        }}
        event={emailModalEvent}
        suggestedDate={emailModalSuggestedDate}
      />
      <CreateEventLinkModal
        isOpen={createEventModalOpen}
        onClose={() => setCreateEventModalOpen(false)}
      />
      <AddJobModal
        isOpen={addJobModalOpen}
        onClose={() => setAddJobModalOpen(false)}
        onAdd={(event) => setEvents((prev) => [...prev, event])}
      />

      {isClearRecentModalOpen && (
        <div
          className="dashboard-popup-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-recent-title"
        >
          <div className="dashboard-popup-modal">
            <div className="dashboard-popup-header">
              <h2 id="clear-recent-title" className="dashboard-popup-title">
                Clear recent activity
              </h2>
              <button
                type="button"
                className="dashboard-popup-close"
                onClick={cancelClearRecentActivity}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="dashboard-popup-body">
              <p>
                This only clears the list in <strong>Recent activity</strong>. Your events, meetings,
                and schedule stay on the calendar.
              </p>
            </div>
            <div className="dashboard-popup-footer">
              <button
                type="button"
                className="dashboard-popup-btn secondary"
                onClick={cancelClearRecentActivity}
              >
                Cancel
              </button>
              <button
                type="button"
                className="dashboard-popup-btn danger"
                onClick={confirmClearRecentActivity}
              >
                Clear list
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
