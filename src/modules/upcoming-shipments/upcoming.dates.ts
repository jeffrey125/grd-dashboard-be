import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(isoWeek);
dayjs.extend(utc);
dayjs.extend(timezone);

export const UPCOMING_TIMEZONE = 'America/Chicago';

export function upcomingWindow(now = new Date()) {
  const today = dayjs(now).tz(UPCOMING_TIMEZONE);
  const from = today.format('YYYY-MM-DD');
  const weekStart = today.startOf('isoWeek').format('YYYY-MM-DD');
  const monthStart = today.startOf('month').format('YYYY-MM-DD');
  const monthEnd = today.endOf('month').format('YYYY-MM-DD');
  const weekEnd = today.endOf('isoWeek').format('YYYY-MM-DD');

  return {
    from,
    weekStart,
    monthStart,
    snapshotStart: weekStart < monthStart ? weekStart : monthStart,
    month: today.format('YYYY-MM'),
    monthEnd,
    weekEnd,
    through: monthEnd > weekEnd ? monthEnd : weekEnd,
    timezone: UPCOMING_TIMEZONE,
  };
}
