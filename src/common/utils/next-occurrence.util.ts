import { getMonth, getDate, getYear, isBefore, isAfter } from 'date-fns';
import { TimezoneUtil } from './timezone.util';

/**
 * Recurring event interface (subset of Prisma RecurringEvent model)
 */
export interface RecurringEventInput {
  eventDate: Date; // Stores MM-DD using fixed-year 2000 convention (e.g., 2000-02-14)
  notificationTime: string; // HH:MM:SS format (e.g., '09:00:00')
}

/**
 * Leap year policy for Feb 29 events in non-leap years
 */
export enum LeapYearPolicy {
  USE_FEB_28 = 'USE_FEB_28', // Use Feb 28 for non-leap years (default)
  SKIP_YEAR = 'SKIP_YEAR',   // Skip the year entirely (not recommended for annual events)
}

/**
 * Compute the next occurrence of a recurring annual event
 * 
 * Handles:
 * - Timezone-aware scheduling (returns UTC time for local notification time)
 * - Leap year policy (Feb 29 → Feb 28 in non-leap years by default)
 * - DST transitions (spring forward/fall back)
 * - Year boundaries (Dec 31 → Jan 1)
 * 
 * @param event - Recurring event with eventDate (fixed-year 2000 convention) and notificationTime
 * @param fromDate - Reference date to compute next occurrence from (defaults to now)
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 * @param policy - Leap year policy for Feb 29 events (defaults to USE_FEB_28)
 * @returns Next occurrence as UTC Date representing local notification time
 * 
 * @example
 * ```typescript
 * const event = {
 *   eventDate: new Date(2000, 1, 14), // Feb 14 (fixed-year 2000 convention)
 *   notificationTime: '09:00:00'
 * };
 * const next = nextOccurrence(event, new Date(), 'America/New_York');
 * // Returns UTC date for Feb 14 at 9:00 AM New York time
 * ```
 */
export function nextOccurrence(
  event: RecurringEventInput,
  fromDate: Date = new Date(),
  timezone: string,
  policy: LeapYearPolicy = LeapYearPolicy.USE_FEB_28,
): Date {
  // Validate timezone
  if (!TimezoneUtil.isValidTimezone(timezone)) {
    throw new Error(`Invalid timezone: ${timezone}`);
  }

  // Extract month and day from eventDate (0-indexed month)
  const eventMonth = getMonth(event.eventDate);
  const eventDay = getDate(event.eventDate);

  // Get current year from reference date
  const currentYear = getYear(fromDate);

  // Try this year's occurrence first
  let targetYear = currentYear;
  let occurrenceDate = buildOccurrenceDate(
    eventMonth,
    eventDay,
    targetYear,
    policy,
  );

  // Convert to UTC using user's local notification time
  let occurrenceUtc = TimezoneUtil.toUtc(
    event.notificationTime,
    timezone,
    occurrenceDate,
  );

  // If occurrence is in the past (or equal to fromDate), try next year
  if (!isAfter(occurrenceUtc, fromDate)) {
    targetYear = currentYear + 1;
    occurrenceDate = buildOccurrenceDate(
      eventMonth,
      eventDay,
      targetYear,
      policy,
    );
    occurrenceUtc = TimezoneUtil.toUtc(
      event.notificationTime,
      timezone,
      occurrenceDate,
    );
  }

  return occurrenceUtc;
}

/**
 * Build occurrence date for a given year, handling leap year policy
 * 
 * @param month - Month (0-indexed, 0 = January)
 * @param day - Day of month (1-31)
 * @param year - Target year
 * @param policy - Leap year policy
 * @returns Date object for the occurrence
 */
function buildOccurrenceDate(
  month: number,
  day: number,
  year: number,
  policy: LeapYearPolicy,
): Date {
  // Check if this is a Feb 29 event
  if (month === 1 && day === 29) {
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

    if (!isLeapYear) {
      if (policy === LeapYearPolicy.USE_FEB_28) {
        // Use Feb 28 for non-leap years
        return new Date(year, 1, 28);
      } else if (policy === LeapYearPolicy.SKIP_YEAR) {
        // This shouldn't happen in normal flow, but handle gracefully
        // Return Feb 28 as fallback (caller should handle skipping logic)
        return new Date(year, 1, 28);
      }
    }
  }

  // Normal case: use the exact month/day
  return new Date(year, month, day);
}

/**
 * Helper to check if a year is a leap year
 * 
 * @param year - Year to check
 * @returns true if leap year, false otherwise
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

