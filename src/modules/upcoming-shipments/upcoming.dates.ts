import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export const UPCOMING_TIMEZONE = 'America/Chicago';

export function upcomingWindow(now = new Date()) {
  const today = dayjs(now).tz(UPCOMING_TIMEZONE);
  const from = today.format('YYYY-MM-DD');
  const monthEnd = today.endOf('month').format('YYYY-MM-DD');
  const weekEnd = today.add((7 - today.day()) % 7, 'day').format('YYYY-MM-DD');

  return {
    from,
    month: today.format('YYYY-MM'),
    monthEnd,
    weekEnd,
    through: monthEnd > weekEnd ? monthEnd : weekEnd,
    timezone: UPCOMING_TIMEZONE,
  };
}
