export interface ScheduleEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  color?: 'accent' | 'success' | 'warning' | 'default';
}
