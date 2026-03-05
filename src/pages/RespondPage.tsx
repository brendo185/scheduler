import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
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
} from 'date-fns';
import './RespondPage.css';

const HOUR_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];

function slotToLabel(slot: string): string {
  const h = Number(slot.slice(0, 2)) || 9;
  const nextH = h + 1;
  const period = (hour: number) => (hour < 12 ? 'AM' : 'PM');
  const hour12 = (hour: number) => (hour === 0 ? 12 : hour > 12 ? hour - 12 : hour);
  return `${hour12(h)}:00 ${period(h)} – ${hour12(nextH)}:00 ${period(nextH)}`;
}

interface ScheduleResponse {
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

interface ScheduleRequest {
  id: string;
  subject: string;
  proposedDates: string[];
  eventTitle: string | null;
  responses: ScheduleResponse[];
  takenSlots: Record<string, string[]>;
  hourSlots: string[];
}

export function RespondPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const [request, setRequest] = useState<ScheduleRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [respondentName, setRespondentName] = useState('');
  const [respondentEmail, setRespondentEmail] = useState('');
   const [respondentPhone, setRespondentPhone] = useState('');
  const [respondentStreet, setRespondentStreet] = useState('');
  const [respondentAddress2, setRespondentAddress2] = useState('');
  const [respondentCity, setRespondentCity] = useState('');
  const [respondentState, setRespondentState] = useState('');
  const [respondentPostalCode, setRespondentPostalCode] = useState('');
  const [respondentNotes, setRespondentNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState<Date | null>(null);

  useEffect(() => {
    if (!requestId) {
      setError('Missing request ID.');
      setLoading(false);
      return;
    }
    fetch(`/api/schedule-request/${requestId}`)
      .then((res) => {
        if (!res.ok) return res.json().then((b) => Promise.reject(new Error((b as { message?: string }).message || res.statusText)));
        return res.json();
      })
      .then((data: ScheduleRequest) => {
        setRequest(data);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load.');
      })
      .finally(() => setLoading(false));
  }, [requestId]);

  useEffect(() => {
    if (request && request.proposedDates && request.proposedDates.length > 0) {
      const first = request.proposedDates[0];
      setCurrentMonth(new Date(first + 'T12:00:00'));
    }
  }, [request]);

  const handleSelectDate = useCallback((dateStr: string) => {
    setSelectedDate(dateStr);
    setSelectedSlot(null);
  }, []);

  const handleSelectSlot = useCallback((slot: string) => {
    setSelectedSlot(slot);
  }, []);

  const handleSubmit = useCallback(() => {
    if (
      !requestId ||
      !selectedDate ||
      !selectedSlot ||
      !respondentName.trim() ||
      !respondentEmail.trim() ||
      !respondentPhone.trim() ||
      !respondentStreet.trim() ||
      !respondentCity.trim() ||
      !respondentState.trim() ||
      !respondentPostalCode.trim()
    ) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    fetch(`/api/schedule-request/${requestId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedDate,
        selectedSlot,
        respondentName: respondentName.trim(),
        respondentEmail: respondentEmail.trim(),
        respondentPhone: respondentPhone.trim(),
        respondentStreet: respondentStreet.trim(),
        respondentAddress2: respondentAddress2.trim() || undefined,
        respondentCity: respondentCity.trim(),
        respondentState: respondentState.trim(),
        respondentPostalCode: respondentPostalCode.trim(),
        respondentNotes: respondentNotes.trim() || undefined,
      }),
    })
      .then((res) => {
        if (!res.ok) return res.json().then((b) => Promise.reject(new Error((b as { message?: string }).message || res.statusText)));
        return res.json();
      })
      .then(() => setSubmitted(true))
      .catch((e) => {
        setSubmitError(e instanceof Error ? e.message : 'Failed to submit.');
        // Refetch request so taken slots are up to date (e.g. slot was taken by someone else)
        if (requestId) {
          fetch(`/api/schedule-request/${requestId}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data: ScheduleRequest | null) => { if (data) setRequest(data); });
        }
      })
      .finally(() => setSubmitting(false));
  }, [
    requestId,
    selectedDate,
    selectedSlot,
    respondentName,
    respondentEmail,
    respondentPhone,
    respondentStreet,
    respondentAddress2,
    respondentCity,
    respondentState,
    respondentPostalCode,
    respondentNotes,
  ]);

  if (loading) {
    return (
      <div className="respond-page">
        <p className="respond-loading">Loading…</p>
      </div>
    );
  }

  if (error || !request) {
    return (
      <div className="respond-page">
        <div className="respond-card respond-error">
          <h1>Unable to load</h1>
          <p>{error || 'Request not found.'}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="respond-page">
        <div className="respond-card respond-success">
          <h1>Thanks!</h1>
          <p>Your time slot has been recorded. The sender will be notified.</p>
        </div>
      </div>
    );
  }

  const proposedDates = request.proposedDates ?? [];
  const takenSlots = request.takenSlots ?? {};
  const slots = request.hourSlots && request.hourSlots.length > 0 ? request.hourSlots : HOUR_SLOTS;

  const monthBase = currentMonth ?? (proposedDates[0] ? new Date(proposedDates[0] + 'T12:00:00') : new Date());
  const monthStart = startOfMonth(monthBase);
  const monthEnd = endOfMonth(monthBase);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const weeks: Date[][] = [];
  let day = calendarStart;
  while (day <= calendarEnd) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const proposedDateSet = new Set(proposedDates);

  return (
    <div className="respond-page">
      <div className="respond-card">
        <h1 className="respond-title">Choose your time slot</h1>
        {request.eventTitle && <p className="respond-event">{request.eventTitle}</p>}
        <p className="respond-subject">{request.subject}</p>
        <p className="respond-instruction">
          Pick one date and one hour block between 9 AM and 5 PM. Each slot can only be chosen once.
        </p>

        <label className="respond-field">
          <span className="respond-field-label">Your name *</span>
          <input
            type="text"
            className="respond-input"
            placeholder="e.g. Jane Smith"
            value={respondentName}
            onChange={(e) => setRespondentName(e.target.value)}
            autoComplete="name"
            required
          />
        </label>
        <label className="respond-field">
          <span className="respond-field-label">Your phone number *</span>
          <input
            type="tel"
            className="respond-input"
            placeholder="e.g. (555) 123-4567"
            value={respondentPhone}
            onChange={(e) => setRespondentPhone(e.target.value)}
            autoComplete="tel"
            required
          />
        </label>
        <label className="respond-field">
          <span className="respond-field-label">Your email *</span>
          <input
            type="email"
            className="respond-input"
            placeholder="you@example.com"
            value={respondentEmail}
            onChange={(e) => setRespondentEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>

        <label className="respond-field">
          <span className="respond-field-label">Street address *</span>
          <input
            type="text"
            className="respond-input"
            placeholder="e.g. 123 Main St"
            value={respondentStreet}
            onChange={(e) => setRespondentStreet(e.target.value)}
            autoComplete="street-address"
            required
          />
        </label>
        <label className="respond-field">
          <span className="respond-field-label">Apartment, suite, etc. (optional)</span>
          <input
            type="text"
            className="respond-input"
            placeholder="e.g. Apt 4B"
            value={respondentAddress2}
            onChange={(e) => setRespondentAddress2(e.target.value)}
            autoComplete="address-line2"
          />
        </label>
        <label className="respond-field">
          <span className="respond-field-label">City *</span>
          <input
            type="text"
            className="respond-input"
            placeholder="e.g. Springfield"
            value={respondentCity}
            onChange={(e) => setRespondentCity(e.target.value)}
            autoComplete="address-level2"
            required
          />
        </label>
        <label className="respond-field">
          <span className="respond-field-label">State / Province / Region *</span>
          <input
            type="text"
            className="respond-input"
            placeholder="e.g. CA"
            value={respondentState}
            onChange={(e) => setRespondentState(e.target.value)}
            autoComplete="address-level1"
            required
          />
        </label>
        <label className="respond-field">
          <span className="respond-field-label">ZIP / Postal code *</span>
          <input
            type="text"
            className="respond-input"
            placeholder="e.g. 90210"
            value={respondentPostalCode}
            onChange={(e) => setRespondentPostalCode(e.target.value)}
            autoComplete="postal-code"
            required
          />
        </label>
        <label className="respond-field">
          <span className="respond-field-label">Please share anything that Bruce should know prior (optional)</span>
          <textarea
            className="respond-input"
            placeholder="Additional details, access notes, preferences, etc."
            value={respondentNotes}
            onChange={(e) => setRespondentNotes(e.target.value)}
            rows={3}
          />
        </label>

        {proposedDates.length === 0 ? (
          <p className="respond-no-dates">No dates have been suggested for this request.</p>
        ) : (
          <>
            <div className="respond-calendar">
              <div className="respond-calendar-header">
                <button
                  type="button"
                  className="respond-calendar-nav"
                  onClick={() =>
                    setCurrentMonth((prev) =>
                      prev ? subMonths(prev, 1) : subMonths(monthBase, 1)
                    )
                  }
                  aria-label="Previous month"
                >
                  ‹
                </button>
                <div className="respond-calendar-title">
                  {format(monthBase, 'MMMM yyyy')}
                </div>
                <button
                  type="button"
                  className="respond-calendar-nav"
                  onClick={() =>
                    setCurrentMonth((prev) =>
                      prev ? addMonths(prev, 1) : addMonths(monthBase, 1)
                    )
                  }
                  aria-label="Next month"
                >
                  ›
                </button>
              </div>
              <div className="respond-calendar-weekdays">
                {weekDays.map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>
              <div className="respond-calendar-grid">
                {weeks.map((week) =>
                  week.map((date) => {
                    const iso = format(date, 'yyyy-MM-dd');
                    const isProposed = proposedDateSet.has(iso);
                    const inMonth = isSameMonth(date, monthBase);
                    const isSelected =
                      selectedDate != null && isSameDay(date, new Date(selectedDate + 'T12:00:00'));
                    const today = isToday(date);
                    const disabled = !isProposed;
                    return (
                      <button
                        key={date.toISOString()}
                        type="button"
                        className={`respond-calendar-day ${!inMonth ? 'other-month' : ''} ${
                          today ? 'today' : ''
                        } ${isProposed ? 'proposed' : ''} ${
                          disabled ? 'disabled' : ''
                        } ${isSelected ? 'selected' : ''}`}
                        onClick={() => isProposed && handleSelectDate(iso)}
                        disabled={disabled}
                      >
                        {format(date, 'd')}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {selectedDate && (
              <div className="respond-time-panel">
                <div className="respond-time-panel-header">
                  <h3 className="respond-time-title">
                    {format(new Date(selectedDate + 'T12:00:00'), 'EEEE, MMMM d')}
                  </h3>
                  <span className="respond-time-subtitle">Choose a one-hour block</span>
                </div>
                <div className="respond-slot-grid">
                  {slots
                    .filter((slot) => !(takenSlots[selectedDate] ?? []).includes(slot))
                    .map((slot) => {
                      const isSelected = selectedSlot === slot;
                      return (
                        <button
                          key={slot}
                          type="button"
                          className={`respond-slot-btn ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleSelectSlot(slot)}
                          aria-pressed={isSelected}
                          title={slotToLabel(slot)}
                        >
                          {slotToLabel(slot)}
                        </button>
                      );
                    })}
                  {slots.filter((slot) => !(takenSlots[selectedDate] ?? []).includes(slot)).length ===
                    0 && (
                    <p className="respond-time-empty">
                      All time slots for this date have been taken. Try another day.
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {selectedDate && selectedSlot && (
          <p className="respond-summary">
            Selected: {format(new Date(selectedDate + 'T12:00:00'), 'EEEE, MMM d')} — {slotToLabel(selectedSlot)}
          </p>
        )}

        {submitError && (
          <p className="respond-submit-error" role="alert">
            {submitError}
          </p>
        )}

        <div className="respond-actions">
          <button
            type="button"
            className="respond-btn primary"
            onClick={handleSubmit}
            disabled={
              !selectedDate ||
              !selectedSlot ||
              !respondentName.trim() ||
              !respondentEmail.trim() ||
              !respondentPhone.trim() ||
              !respondentStreet.trim() ||
              !respondentCity.trim() ||
              !respondentState.trim() ||
              !respondentPostalCode.trim() ||
              submitting
            }
          >
            {submitting ? 'Submitting…' : 'Confirm time slot'}
          </button>
        </div>
      </div>
    </div>
  );
}
