import { useState } from 'react';
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
import type { ScheduleEvent } from '../types';
import './Calendar.css';

interface CalendarProps {
  events: ScheduleEvent[];
  onSelectDate?: (date: Date) => void;
  selectedDate?: Date | null;
  highlightDates?: Date[];
}

type CalendarViewMode = 'month' | 'week';

export function Calendar({ events, onSelectDate, selectedDate, highlightDates }: CalendarProps) {
  const [current, setCurrent] = useState(new Date());
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');

  const weekStart = startOfWeek(current, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(current, { weekStartsOn: 0 });

  let calStart: Date;
  let calEnd: Date;

  if (viewMode === 'month') {
    const monthStart = startOfMonth(current);
    const monthEnd = endOfMonth(current);
    calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  } else {
    calStart = weekStart;
    calEnd = weekEnd;
  }

  const goPrev = () => {
    setCurrent((prev) => (viewMode === 'month' ? subMonths(prev, 1) : addDays(prev, -7)));
  };

  const goNext = () => {
    setCurrent((prev) => (viewMode === 'month' ? addMonths(prev, 1) : addDays(prev, 7)));
  };

  const rows: Date[][] = [];
  let day = calStart;
  while (day <= calEnd) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    rows.push(week);
  }

  function getEventsForDay(date: Date): ScheduleEvent[] {
    return events.filter((e) => {
      const d = e.start instanceof Date ? e.start : new Date(e.start);
      return isSameDay(d, date);
    });
  }

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="calendar">
      <div className="calendar-header">
        <div className="calendar-nav">
          <div className="calendar-nav-main">
            <button
              type="button"
              className="calendar-nav-btn"
              onClick={goPrev}
              aria-label="Previous period"
            >
              ‹
            </button>
            <h2 className="calendar-title">
              {viewMode === 'month'
                ? format(current, 'MMMM yyyy')
                : `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`}
            </h2>
            <button
              type="button"
              className="calendar-nav-btn"
              onClick={goNext}
              aria-label="Next period"
            >
              ›
            </button>
          </div>
          <div className="calendar-view-toggle" aria-label="Calendar view">
            <button
              type="button"
              className={`calendar-view-btn ${viewMode === 'month' ? 'active' : ''}`}
              onClick={() => setViewMode('month')}
            >
              Month
            </button>
            <button
              type="button"
              className={`calendar-view-btn ${viewMode === 'week' ? 'active' : ''}`}
              onClick={() => setViewMode('week')}
            >
              Week
            </button>
          </div>
        </div>
      </div>
      <div className="calendar-grid">
        {weekDays.map((d) => (
          <div key={d} className="calendar-weekday">
            {d}
          </div>
        ))}
        {rows.map((week) =>
          week.map((date) => {
            const dayEvents = getEventsForDay(date);
            const inMonth = viewMode === 'month' ? isSameMonth(date, current) : true;
            const today = isToday(date);
            const selected = selectedDate != null && isSameDay(date, selectedDate);
            const highlighted =
              Array.isArray(highlightDates) &&
              highlightDates.some((d) => isSameDay(d, date));
            return (
              <button
                key={date.toISOString()}
                type="button"
                className={`calendar-day ${!inMonth ? 'other-month' : ''} ${today ? 'today' : ''} ${selected ? 'selected' : ''} ${highlighted ? 'highlighted' : ''}`}
                onClick={() => onSelectDate?.(date)}
              >
                <span className="calendar-day-num">{format(date, 'd')}</span>
                <div className="calendar-day-events">
                  {dayEvents.slice(0, 4).map((evt) => {
                    const start = evt.start instanceof Date ? evt.start : new Date(evt.start);
                    return (
                      <div
                        key={evt.id}
                        className={`calendar-event-pill ${evt.color || 'default'}`}
                        title={evt.title}
                      >
                        <span className="calendar-event-pill-dot" />
                        <span className="calendar-event-pill-text">
                          {format(start, 'p')} · {evt.title}
                        </span>
                      </div>
                    );
                  })}
                  {dayEvents.length > 4 && (
                    <span className="calendar-more">+{dayEvents.length - 4} more</span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
