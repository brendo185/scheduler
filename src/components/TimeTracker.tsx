import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import type { ScheduleEvent } from '../types';

const COMPLETED_JOBS_STORAGE_KEY = 'scheduler-completed-jobs';

interface CompletedJob {
  id: string;
  eventId: string;
  title: string;
  scheduledStart: string;
  scheduledEnd: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
}

function loadCompletedJobs(): CompletedJob[] {
  try {
    const raw = localStorage.getItem(COMPLETED_JOBS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((job) => {
        if (!job || typeof job !== 'object') return null;
        const j = job as Partial<CompletedJob> & Record<string, unknown>;
        const startedAt = typeof j.startedAt === 'string' ? j.startedAt : null;
        const endedAt = typeof j.endedAt === 'string' ? j.endedAt : null;
        if (!startedAt || !endedAt) return null;
        return {
          id:
            typeof j.id === 'string'
              ? j.id
              : `completed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          eventId: typeof j.eventId === 'string' ? j.eventId : '',
          title: typeof j.title === 'string' ? j.title : 'Job',
          scheduledStart: typeof j.scheduledStart === 'string' ? j.scheduledStart : startedAt,
          scheduledEnd: typeof j.scheduledEnd === 'string' ? j.scheduledEnd : endedAt,
          startedAt,
          endedAt,
          durationSeconds: typeof j.durationSeconds === 'number' && Number.isFinite(j.durationSeconds)
            ? j.durationSeconds
            : Math.max(
                0,
                Math.floor(
                  (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000,
                ),
              ),
        } as CompletedJob;
      })
      .filter((j): j is CompletedJob => j != null);
  } catch {
    return [];
  }
}

function saveCompletedJobs(jobs: CompletedJob[]) {
  try {
    localStorage.setItem(COMPLETED_JOBS_STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // ignore
  }
}

interface TimeTrackerProps {
  events: ScheduleEvent[];
  onActiveJobChange?: (event: ScheduleEvent | null) => void;
  /** Called when a job is completed so parent views (like the calendar) can update. */
  onCompleteEvent?: (eventId: string) => void;
}

export function TimeTracker({ events, onActiveJobChange, onCompleteEvent }: TimeTrackerProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [now, setNow] = useState<Date>(new Date());
  const [completedJobs, setCompletedJobs] = useState<CompletedJob[]>(loadCompletedJobs);
  const [view, setView] = useState<'active' | 'completed'>('active');

  useEffect(() => {
    if (!activeId || !startedAt) return;
    const timerId = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => {
      window.clearInterval(timerId);
    };
  }, [activeId, startedAt]);

  useEffect(() => {
    saveCompletedJobs(completedJobs);
  }, [completedJobs]);

  const sortedEvents = [...events].sort((a, b) => {
    const aStart = a.start instanceof Date ? a.start : new Date(a.start);
    const bStart = b.start instanceof Date ? b.start : new Date(b.start);
    return aStart.getTime() - bStart.getTime();
  });

  // Hide any events that already have a completed job record so that
  // they move to "Completed" and disappear from the active list.
  const completedEventIds = new Set(completedJobs.map((job) => job.eventId).filter(Boolean));
  const pendingEvents = sortedEvents.filter((evt) => !completedEventIds.has(evt.id));

  const completeJob = () => {
    if (activeId && startedAt) {
      const end = new Date();
      const durationSeconds = Math.max(
        0,
        Math.floor((end.getTime() - startedAt.getTime()) / 1000),
      );
      const event = events.find((e) => e.id === activeId);
      if (event) {
        const scheduledStart = event.start instanceof Date ? event.start : new Date(event.start);
        const scheduledEnd = event.end instanceof Date ? event.end : new Date(event.end);
        const record: CompletedJob = {
          id: `completed-${activeId}-${end.getTime()}`,
          eventId: activeId,
          title: event.title,
          scheduledStart: scheduledStart.toISOString(),
          scheduledEnd: scheduledEnd.toISOString(),
          startedAt: startedAt.toISOString(),
          endedAt: end.toISOString(),
          durationSeconds,
        };
        setCompletedJobs((prev) => [record, ...prev]);
        if (onCompleteEvent) {
          onCompleteEvent(activeId);
        }
      }
    }

    setActiveId(null);
    setStartedAt(null);
    if (onActiveJobChange) {
      onActiveJobChange(null);
    }
  };

  const startJob = (id: string) => {
    if (activeId && startedAt) {
      // Finish the current job before starting a new one.
      completeJob();
    }
    setActiveId(id);
    setStartedAt(new Date());
    setNow(new Date());
    setView('active');
    const event = events.find((e) => e.id === id) || null;
    if (event && onActiveJobChange) {
      onActiveJobChange(event);
    }
  };

  let elapsedLabel = '00:00:00';
  if (activeId && startedAt) {
    const diffMs = now.getTime() - startedAt.getTime();
    const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    elapsedLabel = `${hours}:${minutes}:${seconds}`;
  }

  const hasEvents = pendingEvents.length > 0;
  const hasCompletedJobs = completedJobs.length > 0;

  const groups = pendingEvents.reduce<Record<string, ScheduleEvent[]>>((acc, evt) => {
    const start = evt.start instanceof Date ? evt.start : new Date(evt.start);
    const key = format(start, 'yyyy-MM-dd');
    if (!acc[key]) acc[key] = [];
    acc[key].push(evt);
    return acc;
  }, {});

  const dateKeys = Object.keys(groups).sort();

  const completedGroups = completedJobs.reduce<Record<string, CompletedJob[]>>((acc, job) => {
    const base = new Date(job.startedAt || job.endedAt);
    if (Number.isNaN(base.getTime())) return acc;
    const key = format(base, 'yyyy-MM-dd');
    if (!acc[key]) acc[key] = [];
    acc[key].push(job);
    return acc;
  }, {});

  const completedDateKeys = Object.keys(completedGroups).sort().reverse();

  const formatDurationMinutes = (totalMinutes: number): string => {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
    }
    return `${minutes}m`;
  };

  const formatDurationFromSeconds = (seconds: number): string => {
    const totalMinutes = Math.floor(Math.max(0, seconds) / 60);
    return formatDurationMinutes(totalMinutes);
  };

  return (
    <div className="dashboard-card time-tracker-card">
      <div className="dashboard-card-header">
        <h3 className="dashboard-card-title">Schedule</h3>
        {(hasEvents || hasCompletedJobs) && (
          <div className="meetings-view-toggle" aria-label="Schedule view">
            <button
              type="button"
              className={`meetings-view-btn ${view === 'active' ? 'active' : ''}`}
              onClick={() => setView('active')}
            >
              Active
            </button>
            <button
              type="button"
              className={`meetings-view-btn ${view === 'completed' ? 'active' : ''}`}
              onClick={() => setView('completed')}
            >
              Completed
            </button>
          </div>
        )}
      </div>

      {view === 'active' ? (
        !hasEvents ? (
          <p className="dashboard-empty">No scheduled jobs available yet.</p>
        ) : (
          <div className="schedule-list">
            {dateKeys.map((dateKey) => {
              const date = new Date(`${dateKey}T12:00:00`);
              const label = format(date, 'EEEE, MMMM d');
              const dayEvents = groups[dateKey];
              return (
                <section key={dateKey} className="schedule-day-group">
                  <h4 className="schedule-day-header">{label}</h4>
                  <div className="schedule-day-cards">
                    {dayEvents.map((evt) => {
                      const start = evt.start instanceof Date ? evt.start : new Date(evt.start);
                      const end = evt.end instanceof Date ? evt.end : new Date(evt.end);
                      const durationMs = end.getTime() - start.getTime();
                      const durationMinutes = Math.max(0, Math.round(durationMs / 60000));
                      const durationLabel = formatDurationMinutes(durationMinutes);

                      const isActive = activeId === evt.id && !!startedAt;

                      return (
                        <article key={evt.id} className="schedule-job-card">
                          <div className="schedule-job-main">
                            <div className="schedule-job-title-row">
                              <span className="schedule-job-title">{evt.title}</span>
                              <span className="schedule-job-duration">{durationLabel}</span>
                            </div>
                            <p className="schedule-job-time">
                              {format(start, 'p')} – {format(end, 'p')}
                            </p>
                          </div>
                          <div className="schedule-job-actions">
                            {isActive ? (
                              <>
                                <span className="time-tracker-timer">{elapsedLabel}</span>
                                <button
                                  type="button"
                                  className="time-tracker-btn danger"
                                  onClick={completeJob}
                                >
                                  Complete job
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="time-tracker-btn primary"
                                onClick={() => startJob(evt.id)}
                              >
                                Start job
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )
      ) : !hasCompletedJobs ? (
        <p className="dashboard-empty">No completed jobs yet.</p>
      ) : (
        <div className="schedule-list">
          {completedDateKeys.map((dateKey) => {
            const date = new Date(`${dateKey}T12:00:00`);
            const label = format(date, 'EEEE, MMMM d');
            const jobsForDay = completedGroups[dateKey];
            return (
              <section key={dateKey} className="schedule-day-group">
                <h4 className="schedule-day-header">{label}</h4>
                <div className="schedule-day-cards">
                  {jobsForDay.map((job) => {
                    const started = new Date(job.startedAt);
                    const ended = new Date(job.endedAt);
                    const durationLabel = formatDurationFromSeconds(job.durationSeconds);

                    return (
                      <article key={job.id} className="schedule-job-card">
                        <div className="schedule-job-main">
                          <div className="schedule-job-title-row">
                            <span className="schedule-job-title">{job.title}</span>
                            <span className="schedule-job-duration">Tracked {durationLabel}</span>
                          </div>
                          <p className="schedule-job-time">
                            {format(started, 'p')} – {format(ended, 'p')}
                          </p>
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
    </div>
  );
}

