import { useEffect, useMemo, useState } from 'react';
import { Command } from '@tauri-apps/plugin-shell';
import './App.css';

const SHUTDOWN_TASK_NAME = 'MaxShutdownTimer';
const WARNING_TASK_NAME = 'MaxShutdownTimerWarning';

type ScheduleMode = 'once' | 'daily';

type ShutdownAction = 'shutdown' | 'restart';

interface TaskStatus {
  exists: boolean;
  taskName: string;
  nextRunTime?: string;
  scheduleType?: string;
  taskToRun?: string;
  lastRunTime?: string;
  raw?: string;
}

function App() {
  const defaultTarget = getDefaultTargetDate();

  const [date, setDate] = useState(formatDateInput(defaultTarget));
  const [time, setTime] = useState(formatTimeInput(defaultTarget));
  const [mode, setMode] = useState<ScheduleMode>('once');
  const [action, setAction] = useState<ShutdownAction>('shutdown');
  const [forceCloseApps, setForceCloseApps] = useState(true);
  const [warningEnabled, setWarningEnabled] = useState(true);
  const [warningMinutes, setWarningMinutes] = useState(10);

  const [status, setStatus] = useState('Loading current shutdown timer...');
  const [currentTask, setCurrentTask] = useState<TaskStatus | null>(null);
  const [currentWarningTask, setCurrentWarningTask] =
    useState<TaskStatus | null>(null);
  const [details, setDetails] = useState('');
  const [now, setNow] = useState(() => new Date());

  const validationMessage = useMemo(
    () => validateSchedule(date, time, mode, warningEnabled, warningMinutes),
    [date, time, mode, warningEnabled, warningMinutes],
  );

  useEffect(() => {
    void checkShutdownTimer();

    const intervalId = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  const nextRunDate = useMemo(
    () => parseTaskDate(currentTask?.nextRunTime),
    [currentTask?.nextRunTime],
  );

  const timeUntilShutdown = useMemo(
    () => formatRelativeTime(nextRunDate, now),
    [nextRunDate, now],
  );

  async function checkShutdownTimer() {
    setStatus('Checking shutdown timer...');
    setDetails('');

    const [shutdownTask, warningTask] = await Promise.all([
      getScheduledTask(SHUTDOWN_TASK_NAME),
      getScheduledTask(WARNING_TASK_NAME),
    ]);

    setCurrentTask(shutdownTask);
    setCurrentWarningTask(warningTask);

    if (!shutdownTask.exists) {
      setStatus('No shutdown timer is currently set.');
      return;
    }

    setStatus(getFriendlyTaskStatus(shutdownTask, warningTask));
  }

  async function onSetShutdownTimerClick() {
    const error = validateSchedule(
      date,
      time,
      mode,
      warningEnabled,
      warningMinutes,
    );

    if (error) {
      setStatus(error);
      return;
    }

    setStatus('Setting shutdown timer...');
    setDetails('');

    const targetDate = getTargetDate(date, time);
    const shutdownArgs = buildShutdownArgs(action, forceCloseApps);

    const createShutdownResult = await runSchtasks([
      '/Create',
      '/TN',
      SHUTDOWN_TASK_NAME,
      '/SC',
      mode === 'daily' ? 'DAILY' : 'ONCE',
      '/ST',
      time,
      ...(mode === 'once' ? ['/SD', formatSchtasksDate(targetDate)] : []),
      '/TR',
      `shutdown.exe ${shutdownArgs}`,
      '/F',
    ]);

    if (createShutdownResult.code !== 0) {
      setStatus('Could not set shutdown timer.');
      setDetails(createShutdownResult.stderr || createShutdownResult.stdout);
      return;
    }

    await deleteTaskIfExists(WARNING_TASK_NAME);

    if (warningEnabled && warningMinutes > 0) {
      const warningTarget = new Date(
        targetDate.getTime() - warningMinutes * 60 * 1000,
      );

      const createWarningResult = await runSchtasks([
        '/Create',
        '/TN',
        WARNING_TASK_NAME,
        '/SC',
        mode === 'daily' ? 'DAILY' : 'ONCE',
        '/ST',
        formatTimeInput(warningTarget),
        ...(mode === 'once' ? ['/SD', formatSchtasksDate(warningTarget)] : []),
        '/TR',
        `msg * Computer will ${action} in ${warningMinutes} minutes.`,
        '/F',
      ]);

      if (createWarningResult.code !== 0) {
        setStatus(
          'Shutdown timer was set, but the warning notification could not be set.',
        );
        setDetails(createWarningResult.stderr || createWarningResult.stdout);
        await checkShutdownTimer();
        return;
      }
    }

    await checkShutdownTimer();
  }

  async function onCancelShutdownTimerClick() {
    setStatus('Canceling shutdown timer...');
    setDetails('');

    await Promise.all([
      deleteTaskIfExists(SHUTDOWN_TASK_NAME),
      deleteTaskIfExists(WARNING_TASK_NAME),
    ]);

    await checkShutdownTimer();
  }

  function onUseNextValidTimeClick() {
    const next = getDefaultTargetDate();
    setDate(formatDateInput(next));
    setTime(formatTimeInput(next));
  }

  return (
    <main className="container">
      <header className="app-header">
        <div>
          <p className="eyebrow">Windows utility</p>
          <h1>Shutdown Timer</h1>
          <p className="subtitle">
            Schedule a shutdown without thinking about it again.
          </p>
        </div>
      </header>

      <section
        className={`card status-card ${currentTask?.exists ? 'is-active' : ''}`}
      >
        <div className="status-heading">
          <div>
            <p className="section-label">Status</p>
            <h2>{currentTask?.exists ? 'Timer active' : 'No timer set'}</h2>
          </div>
          <span
            className={`status-dot ${currentTask?.exists ? 'active' : ''}`}
            aria-hidden="true"
          />
        </div>

        <p className="status-message">{status}</p>

        {currentTask?.exists && (
          <div className="status-grid">
            <div className="stat primary-stat">
              <span className="stat-label">Time until shutdown</span>
              <strong className="countdown">{timeUntilShutdown}</strong>
            </div>
            <div className="stat">
              <span className="stat-label">Next shutdown</span>
              <strong>
                {formatDisplayDate(nextRunDate, currentTask.nextRunTime)}
              </strong>
            </div>
            <div className="stat">
              <span className="stat-label">Schedule</span>
              <strong>{currentTask.scheduleType || 'Unknown'}</strong>
            </div>
            <div className="stat">
              <span className="stat-label">Warning</span>
              <strong>
                {currentWarningTask?.exists
                  ? formatDisplayDate(
                      parseTaskDate(currentWarningTask.nextRunTime),
                      currentWarningTask.nextRunTime,
                    )
                  : 'Off'}
              </strong>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="section-label">Configuration</p>
            <h2>Schedule shutdown</h2>
          </div>
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="mode">Schedule</label>
            <select
              id="mode"
              value={mode}
              onChange={(event) =>
                setMode(event.currentTarget.value as ScheduleMode)
              }
            >
              <option value="once">One time</option>
              <option value="daily">Daily</option>
            </select>
          </div>

          {mode === 'once' && (
            <div className="field">
              <label htmlFor="shutdown-date">Date</label>
              <input
                id="shutdown-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.currentTarget.value)}
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="shutdown-time">Time</label>
            <input
              id="shutdown-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.currentTarget.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="action">Action</label>
            <select
              id="action"
              value={action}
              onChange={(event) =>
                setAction(event.currentTarget.value as ShutdownAction)
              }
            >
              <option value="shutdown">Shutdown</option>
              <option value="restart">Restart</option>
            </select>
          </div>
        </div>

        <div className="option-list">
          <label className="check-option">
            <input
              type="checkbox"
              checked={forceCloseApps}
              onChange={(event) =>
                setForceCloseApps(event.currentTarget.checked)
              }
            />
            <span>
              <strong>Force close apps</strong>
              <small>
                Close running apps without waiting for confirmation.
              </small>
            </span>
          </label>

          <label className="check-option">
            <input
              type="checkbox"
              checked={warningEnabled}
              onChange={(event) =>
                setWarningEnabled(event.currentTarget.checked)
              }
            />
            <span>
              <strong>Show warning first</strong>
              <small>Display a Windows message before shutdown.</small>
            </span>
          </label>
        </div>

        {warningEnabled && (
          <div className="field warning-field">
            <label htmlFor="warning-minutes">Warning minutes before</label>
            <input
              id="warning-minutes"
              type="number"
              min="1"
              max="120"
              value={warningMinutes}
              onChange={(event) =>
                setWarningMinutes(Number(event.currentTarget.value))
              }
            />
          </div>
        )}

        {validationMessage && (
          <p className="validation-message">{validationMessage}</p>
        )}

        <div className="button-row">
          <button
            className="primary-button"
            type="button"
            onClick={onSetShutdownTimerClick}
            disabled={Boolean(validationMessage)}
          >
            Set / Update
          </button>

          <button type="button" onClick={checkShutdownTimer}>
            Refresh status
          </button>

          <button type="button" onClick={onUseNextValidTimeClick}>
            Use next valid time
          </button>

          <button
            className="danger-button"
            type="button"
            onClick={onCancelShutdownTimerClick}
          >
            Cancel timer
          </button>
        </div>
      </section>

      {details && (
        <section className="card details-card">
          <h2>Details</h2>
          <pre>{details}</pre>
        </section>
      )}
    </main>
  );
}

async function getScheduledTask(taskName: string): Promise<TaskStatus> {
  const result = await runSchtasks([
    '/Query',
    '/TN',
    taskName,
    '/V',
    '/FO',
    'CSV',
  ]);

  if (result.code !== 0) {
    return {
      exists: false,
      taskName,
      raw: result.stderr || result.stdout,
    };
  }

  const rows = parseCsv(result.stdout);

  if (rows.length < 2) {
    return {
      exists: true,
      taskName,
      raw: result.stdout,
    };
  }

  const headers = rows[0];
  const values = rows[1];

  const getValue = (header: string) => {
    const index = headers.findIndex(
      (candidate) => candidate.toLowerCase() === header.toLowerCase(),
    );

    return index >= 0 ? values[index] : undefined;
  };

  return {
    exists: true,
    taskName,
    nextRunTime: getValue('Next Run Time'),
    scheduleType: getValue('Schedule Type'),
    taskToRun: getValue('Task To Run'),
    lastRunTime: getValue('Last Run Time'),
    raw: result.stdout,
  };
}

async function deleteTaskIfExists(taskName: string): Promise<void> {
  const task = await getScheduledTask(taskName);

  if (!task.exists) {
    return;
  }

  await runSchtasks(['/Delete', '/TN', taskName, '/F']);
}

async function runSchtasks(args: string[]) {
  return await Command.create('schtasks', args).execute();
}

function buildShutdownArgs(
  action: ShutdownAction,
  forceCloseApps: boolean,
): string {
  const actionArg = action === 'restart' ? '/r' : '/s';
  const forceArg = forceCloseApps ? ' /f' : '';

  return `${actionArg}${forceArg} /t 0`;
}

function validateSchedule(
  date: string,
  time: string,
  mode: ScheduleMode,
  warningEnabled: boolean,
  warningMinutes: number,
): string {
  if (!time) {
    return 'Choose a shutdown time.';
  }

  if (mode === 'once' && !date) {
    return 'Choose a shutdown date.';
  }

  const targetDate = getTargetDate(date, time);

  if (Number.isNaN(targetDate.getTime())) {
    return 'The selected date/time is invalid.';
  }

  const now = new Date();
  const minimumAllowed = new Date(now.getTime() + 60 * 1000);

  if (mode === 'once' && targetDate <= minimumAllowed) {
    return 'For a one-time shutdown, choose a time at least 1 minute in the future.';
  }

  if (warningEnabled) {
    if (!Number.isFinite(warningMinutes)) {
      return 'Warning minutes must be a number.';
    }

    if (warningMinutes < 1 || warningMinutes > 120) {
      return 'Warning minutes must be between 1 and 120.';
    }

    if (mode === 'once') {
      const warningDate = new Date(
        targetDate.getTime() - warningMinutes * 60 * 1000,
      );

      if (warningDate <= now) {
        return 'The warning time would be in the past. Lower the warning minutes or choose a later shutdown time.';
      }
    }
  }

  return '';
}

function getTargetDate(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

function getDefaultTargetDate(): Date {
  const target = new Date();
  target.setHours(23, 30, 0, 0);

  const now = new Date();
  const minimumAllowed = new Date(now.getTime() + 60 * 1000);

  if (target <= minimumAllowed) {
    target.setDate(target.getDate() + 1);
  }

  return target;
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function formatTimeInput(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');

  return `${hours}:${minutes}`;
}

function formatSchtasksDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const year = date.getFullYear();

  return `${month}/${day}/${year}`;
}

function getFriendlyTaskStatus(
  shutdownTask: TaskStatus,
  warningTask: TaskStatus,
): string {
  const runTime = shutdownTask.nextRunTime || 'an unknown time';
  const scheduleType = shutdownTask.scheduleType || 'unknown schedule';

  if (warningTask.exists) {
    return `Shutdown timer is set for ${runTime}. Schedule: ${scheduleType}. Warning is enabled.`;
  }

  return `Shutdown timer is set for ${runTime}. Schedule: ${scheduleType}.`;
}

function parseTaskDate(value?: string): Date | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || /^(n\/a|never|disabled)$/i.test(trimmed)) {
    return null;
  }

  const parsed = new Date(trimmed);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  const match = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i,
  );

  if (!match) {
    return null;
  }

  const [, month, day, year, rawHour, minute, second = '0', meridiem] = match;
  let hour = Number(rawHour);

  if (meridiem) {
    hour %= 12;

    if (meridiem.toUpperCase() === 'PM') {
      hour += 12;
    }
  }

  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    hour,
    Number(minute),
    Number(second),
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatRelativeTime(target: Date | null, now: Date): string {
  if (!target) {
    return 'Unknown';
  }

  const totalSeconds = Math.max(
    0,
    Math.ceil((target.getTime() - now.getTime()) / 1000),
  );

  if (totalSeconds === 0) {
    return 'Any moment';
  }

  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatDisplayDate(date: Date | null, fallback?: string): string {
  if (!date) {
    return fallback || 'Unknown';
  }

  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let insideQuotes = false;

  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    const nextChar = csv[index + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      value += '"';
      index++;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === ',' && !insideQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index++;
      }

      row.push(value);
      value = '';

      if (row.some((cell) => cell.trim().length > 0)) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    value += char;
  }

  if (value || row.length) {
    row.push(value);

    if (row.some((cell) => cell.trim().length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

export default App;
