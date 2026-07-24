export type ScheduleMode = 'once' | 'daily';

export type ShutdownAction = 'shutdown' | 'restart';

export interface TaskStatus {
  exists: boolean;
  taskName: string;
  nextRunTime?: string;
  scheduleType?: string;
  taskToRun?: string;
  lastRunTime?: string;
  raw?: string;
}
