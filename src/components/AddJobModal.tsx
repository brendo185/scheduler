import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import type { ScheduleEvent } from '../types';
import './AddJobModal.css';

export interface AddJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (event: ScheduleEvent) => void;
}

export function AddJobModal({ isOpen, onClose, onAdd }: AddJobModalProps) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDate(format(new Date(), 'yyyy-MM-dd'));
      setStartTime('09:00');
      setEndTime('10:00');
    }
  }, [isOpen]);

  const handleSubmit = () => {
    const trimmed = title.trim();
    if (!trimmed || !date) return;
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const base = new Date(date + 'T12:00:00');
    const start = new Date(base);
    start.setHours(Number.isNaN(startH) ? 9 : startH, Number.isNaN(startM) ? 0 : startM, 0, 0);
    const end = new Date(base);
    end.setHours(Number.isNaN(endH) ? 10 : endH, Number.isNaN(endM) ? 0 : endM, 0, 0);
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    onAdd({ id, title: trimmed, start, end, color: 'default' });
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="add-job-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-job-title"
    >
      <div className="add-job-modal">
        <div className="add-job-header">
          <h2 id="add-job-title" className="add-job-title">
            Add job
          </h2>
          <button
            type="button"
            className="add-job-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="add-job-form">
          <label className="add-job-label">
            <span>Title</span>
            <input
              type="text"
              className="add-job-input"
              placeholder="e.g. Client call, Team standup"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </label>
          <label className="add-job-label">
            <span>Date</span>
            <input
              type="date"
              className="add-job-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <div className="add-job-row">
            <label className="add-job-label">
              <span>Start</span>
              <input
                type="time"
                className="add-job-input"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </label>
            <label className="add-job-label">
              <span>End</span>
              <input
                type="time"
                className="add-job-input"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="add-job-footer">
          <button type="button" className="add-job-btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="add-job-btn primary"
            onClick={handleSubmit}
            disabled={!title.trim() || !date}
          >
            Add job
          </button>
        </div>
      </div>
    </div>
  );
}
