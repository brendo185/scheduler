import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  isToday,
  startOfDay,
} from 'date-fns';
import { buildMailtoUrl } from '../lib/mailto';
import type { ScheduleEvent } from '../types';
import './EmailScheduleModal.css';

export interface EmailScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Prefill with an existing event (e.g. when inviting someone to this event) */
  event?: ScheduleEvent | null;
  /** Prefill with a selected date (e.g. when suggesting a meeting time) */
  suggestedDate?: Date | null;
}

const SUBJECT_OPTIONS = [
  'Spring system start-up (turn on & inspection)',
  'Winterization / blowout',
  'Mid-season system check',
  'Seasonal controller reprogramming',
  'System pressure testing',
  'Backflow preventer testing',
  'Backflow certification (where required)',
  'Drain and pump shutdown',
  'Annual maintenance agreement service',
];

const defaultSubject = SUBJECT_OPTIONS[0];
const COMPANY_NAME = 'Layman Irrigation';

/** Service-specific intro sentence for the email body */
function getServiceIntro(serviceSubject: string): string {
  const intros: Record<string, string> = {
    [SUBJECT_OPTIONS[0]]: 'We at Layman Irrigation are reaching out to schedule your spring system start-up (turn on & inspection).',
    [SUBJECT_OPTIONS[1]]: 'We at Layman Irrigation would like to schedule your winterization and blowout service.',
    [SUBJECT_OPTIONS[2]]: 'We at Layman Irrigation are reaching out to schedule a mid-season system check.',
    [SUBJECT_OPTIONS[3]]: 'We at Layman Irrigation would like to schedule your seasonal controller reprogramming.',
    [SUBJECT_OPTIONS[4]]: 'We at Layman Irrigation are reaching out to schedule system pressure testing.',
    [SUBJECT_OPTIONS[5]]: 'We at Layman Irrigation would like to schedule your backflow preventer testing.',
    [SUBJECT_OPTIONS[6]]: 'We at Layman Irrigation are reaching out to schedule backflow certification (where required).',
    [SUBJECT_OPTIONS[7]]: 'We at Layman Irrigation would like to schedule your drain and pump shutdown.',
    [SUBJECT_OPTIONS[8]]: 'We at Layman Irrigation are reaching out to schedule your annual maintenance agreement service.',
  };
  return intros[serviceSubject] ?? `We at Layman Irrigation are reaching out to schedule your ${serviceSubject.toLowerCase()}.`;
}

/** Build the default email body for the selected service; dates are inserted by bodyForSend. Times are fixed 9 AM–5 PM in hour blocks. */
function getBodyTemplateForService(serviceSubject: string): string {
  const intro = getServiceIntro(serviceSubject);
  return `Hi,

${intro} Please use the button below to choose one date and a one-hour time slot between 9 AM and 5 PM that works for you.

Best,
${COMPANY_NAME}`;
}

const defaultBody = getBodyTemplateForService(defaultSubject);

function formatEventSummary(evt: ScheduleEvent): string {
  const start = evt.start instanceof Date ? evt.start : new Date(evt.start);
  const end = evt.end instanceof Date ? evt.end : new Date(evt.end);
  return [
    `Event: ${evt.title}`,
    `When: ${format(start, 'EEEE, MMMM d, yyyy')} from ${format(start, 'h:mm a')} – ${format(end, 'h:mm a')}`,
  ].join('\n');
}

function formatDatesForEmail(dates: Date[]): string {
  if (dates.length === 0) return '';
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  return sorted.map((d) => `• ${format(d, 'EEEE, MMMM d')} (choose one hour between 9 AM – 5 PM)`).join('\n');
}

function sameDayOnly(a: Date, b: Date): boolean {
  return isSameDay(a, b);
}

export function EmailScheduleModal({
  isOpen,
  onClose,
  event = null,
  suggestedDate = null,
}: EmailScheduleModalProps) {
  const [recipients, setRecipients] = useState<string[]>(['']);
  const [clientName, setClientName] = useState('');
  const [subject, setSubject] = useState(() => {
    const initial = event ? `Re: ${event.title}` : defaultSubject;
    return SUBJECT_OPTIONS.includes(initial) ? initial : defaultSubject;
  });
  const [body, setBody] = useState(() => {
    if (event) {
      return [
        `Hi,\n\n${COMPANY_NAME} here—I'd like to invite you to the following:\n\n${formatEventSummary(event)}`,
        `\nPlease let me know if this works or if we need to find another time.\n\nBest,\n${COMPANY_NAME}`,
      ].join('');
    }
    if (suggestedDate) {
      return [
        `Hi,\n\n${COMPANY_NAME} here—I'm suggesting we meet on ${format(suggestedDate, 'EEEE, MMMM d')}.`,
        `\nDoes that work for you? If not, suggest another time.\n\nBest,\n${COMPANY_NAME}`,
      ].join('');
    }
    return getBodyTemplateForService(defaultSubject);
  });
  const [selectedDates, setSelectedDates] = useState<Date[]>(() => {
    if (event) {
      const start = event.start instanceof Date ? event.start : new Date(event.start);
      return [startOfDay(start)];
    }
    if (suggestedDate) return [startOfDay(suggestedDate)];
    return [];
  });
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [sentViaApp, setSentViaApp] = useState<boolean | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const trimmedRecipients = useMemo(
    () => recipients.map((r) => r.trim()).filter(Boolean),
    [recipients],
  );
  const hasAtLeastOneRecipient = trimmedRecipients.length > 0;

  const bodyForSend = useMemo(() => {
    const datesBlock = formatDatesForEmail(selectedDates);
    if (!datesBlock) return body;
    return `Suggested dates (choose one hour between 9 AM – 5 PM):\n${datesBlock}\n\n${body}`;
  }, [selectedDates, body]);

  const isFirstRender = useRef(true);
  // When user changes the type of work (subject) in the dropdown, update the message to match
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (SUBJECT_OPTIONS.includes(subject)) {
      setBody(getBodyTemplateForService(subject));
    }
  }, [subject]);

  const handleRecipientChange = useCallback(
    (index: number, value: string) => {
      setRecipients((prev) => {
        const next = [...prev];
        next[index] = value;
        return next;
      });
    },
    [],
  );

  const handleAddRecipient = useCallback(() => {
    setRecipients((prev) => [...prev, '']);
  }, []);

  const handleRemoveRecipient = useCallback((index: number) => {
    setRecipients((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const toggleDate = useCallback((date: Date) => {
    const day = startOfDay(date);
    setSelectedDates((prev) => {
      const has = prev.some((d) => sameDayOnly(d, day));
      if (has) return prev.filter((d) => !sameDayOnly(d, day));
      return [...prev, day].sort((a, b) => a.getTime() - b.getTime());
    });
  }, []);

  const handleOpenInEmail = useCallback(() => {
    if (!hasAtLeastOneRecipient) return;
    const toField = trimmedRecipients.join(', ');
    const url = buildMailtoUrl({ to: toField, subject, body: bodyForSend });
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      onClose();
    }
  }, [trimmedRecipients, hasAtLeastOneRecipient, subject, bodyForSend, onClose]);

  const [respondUrl, setRespondUrl] = useState<string | null>(null);

  const handleSendViaApp = useCallback(async () => {
    if (!hasAtLeastOneRecipient) return;
    setSentViaApp(null);
    setSendError(null);
    setRespondUrl(null);
    const proposedDates = selectedDates.map((d) => format(d, 'yyyy-MM-dd'));
    try {
      const res = await fetch('/api/send-schedule-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: trimmedRecipients.join(', '),
          recipientName: clientName.trim() || undefined,
          subject: subject || defaultSubject,
          body: bodyForSend || defaultBody,
          proposedDates,
          eventTitle: event?.title ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof data?.message === 'string' ? data.message.trim() : '';
        const fallback =
          res.status === 502 || res.status === 504
            ? 'Server not running. Run `npm run server` in a separate terminal and set RESEND_API_KEY in .env, or use "Open in email".'
            : res.status === 500
              ? 'Server error (500). Look at the terminal where you ran `npm run server` for the real error. Fix RESEND_API_KEY or FROM_EMAIL, or use "Open in email".'
              : `Failed to send (${res.status}). Use "Open in email" to use your mail client.`;
        setSendError(msg || fallback);
        setSentViaApp(false);
        return;
      }
      setSentViaApp(true);
      const url = data.respondUrl && proposedDates.length > 0 ? data.respondUrl : null;
      if (url) setRespondUrl(url);
      setTimeout(() => onClose(), url ? 4000 : 1500);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : 'Network error. Is the server running? Run npm run server and set RESEND_API_KEY, or use "Open in email".';
      setSendError(msg);
      setSentViaApp(false);
    }
  }, [trimmedRecipients, hasAtLeastOneRecipient, clientName, subject, bodyForSend, selectedDates, event?.title, onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="email-schedule-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-schedule-title"
    >
      <div className="email-schedule-modal">
        <div className="email-schedule-header">
          <h2 id="email-schedule-title" className="email-schedule-title">
            Email to schedule
          </h2>
          <button
            type="button"
            className="email-schedule-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form
          className="email-schedule-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleOpenInEmail();
          }}
        >
          <label className="email-schedule-label">
            To
            <div className="email-schedule-to-list">
              {recipients.map((value, index) => (
                <div key={index} className="email-schedule-to-row">
                  <input
                    type="email"
                    className="email-schedule-input email-schedule-to-input"
                    placeholder={
                      index === 0
                        ? 'client@example.com'
                        : 'additional@example.com'
                    }
                    value={value}
                    onChange={(e) =>
                      handleRecipientChange(index, e.target.value)
                    }
                    required={index === 0}
                  />
                  <div className="email-schedule-to-actions">
                    {recipients.length > 1 && (
                      <button
                        type="button"
                        className="email-schedule-icon-btn"
                        onClick={() => handleRemoveRecipient(index)}
                        aria-label="Remove recipient"
                      >
                        −
                      </button>
                    )}
                    {index === recipients.length - 1 && (
                      <button
                        type="button"
                        className="email-schedule-icon-btn"
                        onClick={handleAddRecipient}
                        aria-label="Add recipient"
                      >
                        +
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </label>
          <label className="email-schedule-label">
            Client name
            <input
              type="text"
              className="email-schedule-input"
              placeholder="e.g. Jane Smith"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              autoComplete="name"
            />
          </label>
          <label className="email-schedule-label">
            Subject
            <select
              className="email-schedule-input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            >
              {SUBJECT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <div className="email-schedule-dates">
            <span className="email-schedule-label">Choose date(s) to suggest</span>
            <div className="email-schedule-calendar">
              <div className="email-schedule-calendar-header">
                <button
                  type="button"
                  className="email-schedule-calendar-nav"
                  onClick={() => setCalendarMonth((m) => subMonths(m, 1))}
                  aria-label="Previous month"
                >
                  ‹
                </button>
                <span className="email-schedule-calendar-title">
                  {format(calendarMonth, 'MMMM yyyy')}
                </span>
                <button
                  type="button"
                  className="email-schedule-calendar-nav"
                  onClick={() => setCalendarMonth((m) => addMonths(m, 1))}
                  aria-label="Next month"
                >
                  ›
                </button>
              </div>
              <div className="email-schedule-calendar-weekdays">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <span key={d} className="email-schedule-calendar-weekday">
                    {d}
                  </span>
                ))}
              </div>
              <div className="email-schedule-calendar-grid">
                {(() => {
                  const monthStart = startOfMonth(calendarMonth);
                  const monthEnd = endOfMonth(calendarMonth);
                  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
                  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
                  const cells: Date[] = [];
                  let day = calStart;
                  while (day <= calEnd) {
                    cells.push(day);
                    day = addDays(day, 1);
                  }
                  return cells.map((date) => {
                    const inMonth = isSameMonth(date, calendarMonth);
                    const today = isToday(date);
                    const selected = selectedDates.some((d) => sameDayOnly(d, date));
                    return (
                      <button
                        key={date.toISOString()}
                        type="button"
                        className={`email-schedule-calendar-day ${!inMonth ? 'other-month' : ''} ${today ? 'today' : ''} ${selected ? 'selected' : ''}`}
                        onClick={() => toggleDate(date)}
                      >
                        {format(date, 'd')}
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
            {selectedDates.length > 0 && (
              <p className="email-schedule-dates-summary">
                {selectedDates.length} date{selectedDates.length !== 1 ? 's' : ''} selected — will be included in the email
              </p>
            )}
          </div>

          <label className="email-schedule-label">
            Message
            <textarea
              className="email-schedule-textarea"
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>

          {sendError && (
            <p className="email-schedule-error">
              {sendError}
            </p>
          )}
          {sentViaApp === true && (
            <div className="email-schedule-success-block">
              <p className="email-schedule-success">Email sent.</p>
              {respondUrl && (
                <p className="email-schedule-respond-link">
                  Recipient can choose date(s) here:{' '}
                  <a href={respondUrl} target="_blank" rel="noopener noreferrer">{respondUrl}</a>
                </p>
              )}
            </div>
          )}

          <div className="email-schedule-actions">
            <button
              type="button"
              className="email-schedule-btn secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="email-schedule-btn secondary"
              onClick={handleSendViaApp}
              disabled={!hasAtLeastOneRecipient}
              title="Requires npm run server and RESEND_API_KEY"
            >
              Send via app
            </button>
            <button
              type="submit"
              className="email-schedule-btn primary"
              disabled={!hasAtLeastOneRecipient}
            >
              Open in email
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
