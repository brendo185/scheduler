import { useState, useCallback, useMemo } from 'react';
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
  isToday,
  startOfDay,
} from 'date-fns';
import { buildMailtoUrl } from '../lib/mailto';
import './EmailScheduleModal.css';

interface CreateEventLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type WorkType =
  | 'Spring system start-up'
  | 'Winterization / blowout'
  | 'Mid-season system check'
  | 'Seasonal controller reprogramming'
  | 'System pressure testing'
  | 'Backflow preventer testing'
  | 'Backflow certification'
  | 'Drain and pump shutdown'
  | 'Annual maintenance agreement service'
  | 'Other';

const WORK_TYPE_OPTIONS: WorkType[] = [
  'Spring system start-up',
  'Winterization / blowout',
  'Mid-season system check',
  'Seasonal controller reprogramming',
  'System pressure testing',
  'Backflow preventer testing',
  'Backflow certification',
  'Drain and pump shutdown',
  'Annual maintenance agreement service',
  'Other',
];

const TIME_OPTIONS = [
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
];

const DEFAULT_START = '09:00';
const DEFAULT_END = '17:00';

function formatTimeLabel(hhmm: string): string {
  const [hStr] = hhmm.split(':');
  const h = Number(hStr) || 0;
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:00 ${period}`;
}

export function CreateEventLinkModal({ isOpen, onClose }: CreateEventLinkModalProps) {
  const [eventName, setEventName] = useState('');
  const [workType, setWorkType] = useState<WorkType>('Spring system start-up');
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [startHour, setStartHour] = useState(DEFAULT_START);
  const [endHour, setEndHour] = useState(DEFAULT_END);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const toggleDate = useCallback((date: Date) => {
    const day = startOfDay(date);
    setSelectedDates((prev) => {
      const exists = prev.some((d) => d.getTime() === day.getTime());
      if (exists) {
        return prev.filter((d) => d.getTime() !== day.getTime());
      }
      return [...prev, day].sort((a, b) => a.getTime() - b.getTime());
    });
  }, []);

  const canSubmit = useMemo(() => {
    if (!eventName.trim()) return false;
    if (selectedDates.length === 0) return false;
    if (startHour >= endHour) return false;
    return true;
  }, [eventName, selectedDates.length, startHour, endHour]);

  const handleCreate = useCallback(async () => {
    if (!canSubmit || creating) return;
    setCreating(true);
    setError(null);
    setCreatedUrl(null);
    try {
      const proposedDates = selectedDates.map((d) => format(d, 'yyyy-MM-dd'));
      const body = {
        subject: eventName.trim(),
        eventTitle: `${eventName.trim()} (${workType})`,
        proposedDates,
        startHour,
        endHour,
      };
      const res = await fetch('/api/event-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          (data && typeof data.message === 'string' && data.message.trim()) ||
          (res.status === 502 || res.status === 504
            ? 'Could not reach the scheduling server. Run `npm run server` in a separate terminal.'
            : res.status === 404
              ? 'Event-link endpoint not found. Make sure the server has been restarted after code changes.'
              : 'Could not create event link. Is `npm run server` running?');
        setError(msg);
        setCreating(false);
        return;
      }
      setCreatedUrl(typeof data.respondUrl === 'string' ? data.respondUrl : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error creating event link.');
    } finally {
      setCreating(false);
    }
  }, [canSubmit, creating, selectedDates, eventName, workType, startHour, endHour]);

  const handleCopy = useCallback(() => {
    if (!createdUrl || !navigator.clipboard) return;
    navigator.clipboard.writeText(createdUrl).catch(() => {
      // ignore clipboard errors
    });
  }, [createdUrl]);

  const handleOpenEmailBlast = useCallback(() => {
    if (!createdUrl) return;
    const subject = `Schedule: ${eventName || 'Appointment'}`;
    const body = `Hi,\n\nUse this link to choose a time that works for you:\n${createdUrl}\n\nThanks!`;
    const mailto = buildMailtoUrl({ subject, body });
    if (mailto) {
      window.open(mailto, '_blank', 'noopener,noreferrer');
    }
  }, [createdUrl, eventName]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!isOpen) return null;

  const monthStart = startOfMonth(calendarMonth);
  const monthEnd = endOfMonth(calendarMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days: Date[] = [];
  let cursor = calStart;
  while (cursor <= calEnd) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return (
    <div
      className="email-schedule-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-event-link-title"
    >
      <div className="email-schedule-modal">
        <div className="email-schedule-header">
          <h2 id="create-event-link-title" className="email-schedule-title">
            Create event link
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

        <div className="email-schedule-form">
          <label className="email-schedule-label">
            Event name
            <input
              type="text"
              className="email-schedule-input"
              placeholder="e.g. 30 Minute Meeting"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              autoFocus
            />
          </label>

          <label className="email-schedule-label">
            Work type
            <select
              className="email-schedule-input"
              value={workType}
              onChange={(e) => setWorkType(e.target.value as WorkType)}
            >
              {WORK_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>

          <div className="email-schedule-dates">
            <span className="email-schedule-label">Allowed dates</span>
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
                {weekDays.map((d) => (
                  <span key={d} className="email-schedule-calendar-weekday">
                    {d}
                  </span>
                ))}
              </div>
              <div className="email-schedule-calendar-grid">
                {days.map((date) => {
                  const inMonth = isSameMonth(date, calendarMonth);
                  const today = isToday(date);
                  const selected = selectedDates.some(
                    (d) => d.getTime() === startOfDay(date).getTime(),
                  );
                  return (
                    <button
                      key={date.toISOString()}
                      type="button"
                      className={`email-schedule-calendar-day ${!inMonth ? 'other-month' : ''} ${
                        today ? 'today' : ''
                      } ${selected ? 'selected' : ''}`}
                      onClick={() => toggleDate(date)}
                    >
                      {format(date, 'd')}
                    </button>
                  );
                })}
              </div>
            </div>
            {selectedDates.length > 0 && (
              <p className="email-schedule-dates-summary">
                {selectedDates.length} date
                {selectedDates.length !== 1 ? 's' : ''} selected — clients can pick any of
                these.
              </p>
            )}
          </div>

          <div className="email-schedule-dates">
            <span className="email-schedule-label">Time frame (per day)</span>
            <div className="email-schedule-time-row">
              <label className="email-schedule-label-inline">
                Start
                <select
                  className="email-schedule-input"
                  value={startHour}
                  onChange={(e) => setStartHour(e.target.value)}
                >
                  {TIME_OPTIONS.slice(0, -1).map((t) => (
                    <option key={t} value={t}>
                      {formatTimeLabel(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="email-schedule-label-inline">
                End
                <select
                  className="email-schedule-input"
                  value={endHour}
                  onChange={(e) => setEndHour(e.target.value)}
                >
                  {TIME_OPTIONS.slice(1).map((t) => (
                    <option key={t} value={t}>
                      {formatTimeLabel(t)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {error && <p className="email-schedule-error">{error}</p>}

          {createdUrl && (
            <div className="email-schedule-success-block">
              <p className="email-schedule-success">Event link created.</p>
              <p className="email-schedule-respond-link">
                Share this link with clients:{' '}
                <a href={createdUrl} target="_blank" rel="noopener noreferrer">
                  {createdUrl}
                </a>
              </p>
              <div className="email-schedule-respond-actions">
                <button
                  type="button"
                  className="email-schedule-btn secondary"
                  onClick={handleCopy}
                >
                  Copy link
                </button>
                <button
                  type="button"
                  className="email-schedule-btn secondary"
                  onClick={handleOpenEmailBlast}
                >
                  Open email blast
                </button>
              </div>
            </div>
          )}

          <div className="email-schedule-actions">
            <button
              type="button"
              className="email-schedule-btn secondary"
              onClick={onClose}
            >
              Close
            </button>
            <button
              type="button"
              className="email-schedule-btn primary"
              onClick={handleCreate}
              disabled={!canSubmit || creating}
            >
              {creating ? 'Creating…' : 'Create event link'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

