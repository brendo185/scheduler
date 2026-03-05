import React from 'react';
import { format } from 'date-fns';
import './MeetingDetailModal.css';

export interface ScheduleResponseRow {
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

export interface ScheduleRequestRow {
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

export interface MeetingDetailModalProps {
  isOpen: boolean;
  request: ScheduleRequestRow | null;
  response: ScheduleResponseRow | null;
  onClose: () => void;
}

function formatSlotLabel(slot: string): string {
  const h = parseInt(slot.slice(0, 2), 10);
  const next = (h + 1) % 24;
  const am = (hour: number) => (hour < 12 ? 'AM' : 'PM');
  const h12 = (hour: number) => (hour === 0 ? 12 : hour > 12 ? hour - 12 : hour);
  return `${h12(h)}:00 ${am(h)} – ${h12(next)}:00 ${am(next)}`;
}

function parseEventTitle(req: ScheduleRequestRow): { title: string; workType: string | null } {
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
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (value == null || String(value).trim() === '') return null;
  return (
    <div className="meeting-detail-row">
      <span className="meeting-detail-label">{label}</span>
      <span className="meeting-detail-value">{value}</span>
    </div>
  );
}

export function MeetingDetailModal({
  isOpen,
  request,
  response,
  onClose,
}: MeetingDetailModalProps) {
  if (!isOpen || !request || !response) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const { title, workType } = parseEventTitle(request);
  const date = new Date(response.selectedDate + 'T12:00:00');
  const dateLabel = format(date, 'EEEE, MMMM d, yyyy');
  const slotLabel = formatSlotLabel(response.selectedSlot);
  const displayName = response.respondentName || 'Client';

  const addressLines = [
    response.respondentStreet,
    response.respondentAddress2,
    [response.respondentCity, response.respondentState, response.respondentPostalCode]
      .filter(Boolean)
      .join(', '),
  ]
    .map((s) => (s || '').trim())
    .filter(Boolean);

  return (
    <div
      className="meeting-detail-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="meeting-detail-title"
    >
      <div className="meeting-detail-modal">
        <div className="meeting-detail-header">
          <h2 id="meeting-detail-title" className="meeting-detail-title">
            {title}
          </h2>
          <button
            type="button"
            className="meeting-detail-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="meeting-detail-body">
          {workType && (
            <p className="meeting-detail-work-type">{workType}</p>
          )}

          <section className="meeting-detail-section">
            <h3 className="meeting-detail-section-title">When</h3>
            <DetailRow label="Date" value={dateLabel} />
            <DetailRow label="Time" value={slotLabel} />
          </section>

          <section className="meeting-detail-section">
            <h3 className="meeting-detail-section-title">Contact</h3>
            <DetailRow label="Name" value={displayName} />
            <DetailRow label="Email" value={response.respondentEmail} />
            <DetailRow label="Phone" value={response.respondentPhone} />
          </section>

          {addressLines.length > 0 && (
            <section className="meeting-detail-section meeting-detail-address-section">
              <h3 className="meeting-detail-section-title">Address</h3>
              <div className="meeting-detail-address">
                {addressLines.map((line, i) => (
                  <span key={i} className="meeting-detail-address-line">
                    {line}
                  </span>
                ))}
              </div>
            </section>
          )}

          {response.respondentNotes && response.respondentNotes.trim() && (
            <section className="meeting-detail-section">
              <h3 className="meeting-detail-section-title">Notes</h3>
              <p className="meeting-detail-notes">{response.respondentNotes}</p>
            </section>
          )}

          <section className="meeting-detail-section meeting-detail-meta">
            <DetailRow label="Invite sent to" value={request.to} />
            <DetailRow label="Subject" value={request.subject} />
            {request.recipientName && (
              <DetailRow label="Recipient" value={request.recipientName} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
