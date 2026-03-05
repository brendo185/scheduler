import { format } from 'date-fns';
import type { ScheduleEvent } from '../types';
import './JobDetailsModal.css';

export interface JobDetailsModalProps {
  isOpen: boolean;
  date: Date | null;
  events: ScheduleEvent[];
  onClose: () => void;
  onEmail: (event: ScheduleEvent) => void;
  onDelete: (event: ScheduleEvent) => void;
}

export function JobDetailsModal({
  isOpen,
  date,
  events,
  onClose,
  onEmail,
  onDelete,
}: JobDetailsModalProps) {
  if (!isOpen || !date) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="job-details-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="job-details-title"
    >
      <div className="job-details-modal">
        <div className="job-details-header">
          <h2 id="job-details-title" className="job-details-title">
            {format(date, 'EEEE, MMMM d')}
          </h2>
          <button
            type="button"
            className="job-details-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="job-details-body">
          {events.length === 0 ? (
            <p className="dashboard-empty">No jobs on this date</p>
          ) : (
            <ul className="event-list">
              {events.map((evt) => (
                <li key={evt.id} className={`event-item ${evt.color || 'default'}`}>
                  <div className="event-item-content">
                    <span className="event-time">
                      {format(evt.start, 'h:mm a')} – {format(evt.end, 'h:mm a')}
                    </span>
                    <span className="event-title">{evt.title}</span>
                  </div>
                  <div className="event-item-actions">
                    <button
                      type="button"
                      className="event-item-email-btn"
                      onClick={() => onEmail(evt)}
                      title="Email to schedule"
                      aria-label={`Email to schedule: ${evt.title}`}
                    >
                      Email
                    </button>
                    <button
                      type="button"
                      className="event-item-delete-btn"
                      onClick={() => onDelete(evt)}
                      title="Delete event"
                      aria-label={`Delete ${evt.title}`}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

