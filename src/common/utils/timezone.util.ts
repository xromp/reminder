import { fromZonedTime, format as formatTZ } from 'date-fns-tz';
import { format, getMonth, getDate, getYear } from 'date-fns';

export class TimezoneUtil {
  /**
   * Calculate the exact UTC time for a local time in a given timezone
   * Handles DST automatically using IANA timezone database
   *
   * @param localTime - The time in local timezone (e.g., 9:00 AM)
   * @param timezone - IANA timezone (e.g., 'America/New_York')
   * @param date - The date for which to calculate (defaults to today)
   * @returns UTC Date object
   */
  static toUtc(localTime: string, timezone: string, date: Date = new Date()): Date {
    const [hours, minutes, seconds = 0] = localTime.split(':').map(Number);

    const localDate = new Date(
      getYear(date),
      getMonth(date),
      getDate(date),
      hours,
      minutes,
      seconds,
    );

    return fromZonedTime(localDate, timezone);
  }

  /**
   * Calculate the scheduled UTC time for a user's 9am birthday
   *
   * @param birthday - User's birthday (MM-DD format or Date object)
   * @param timezone - User's IANA timezone
   * @param year - Year to schedule for (defaults to current year)
   * @returns UTC Date object for 9am local time on birthday
   */
  static calculateBirthdaySchedule(
    birthday: Date,
    timezone: string,
    year?: number,
  ): Date {
    const targetYear = year || getYear(new Date());
    const month = getMonth(birthday);
    const day = getDate(birthday);

    const birthdayThisYear = new Date(targetYear, month, day, 9, 0, 0);

    return this.toUtc('09:00:00', timezone, birthdayThisYear);
  }

  /**
   * Validate if a timezone string is a valid IANA timezone
   *
   * @param timezone - Timezone string to validate
   * @returns true if valid, false otherwise
   */
  static isValidTimezone(timezone: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return true;
    } catch (ex) {
      return false;
    }
  }

  /**
   * Get all supported IANA timezones
   * Note: This is a subset of common timezones for practical use
   */
  static getCommonTimezones(): string[] {
    return [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu',
      'Europe/London',
      'Europe/Paris',
      'Europe/Berlin',
      'Europe/Moscow',
      'Asia/Dubai',
      'Asia/Kolkata',
      'Asia/Bangkok',
      'Asia/Hong_Kong',
      'Asia/Tokyo',
      'Asia/Seoul',
      'Australia/Sydney',
      'Australia/Melbourne',
      'Pacific/Auckland',
    ];
  }

  /**
   * Handle leap year birthdays (Feb 29)
   * Strategy: If not a leap year, use Feb 28
   *
   * @param birthday - Original birthday date
   * @param year - Target year
   * @returns Adjusted date for non-leap years
   */
  static handleLeapYear(birthday: Date, year: number): Date {
    const month = getMonth(birthday);
    const day = getDate(birthday);

    // Check if birthday is Feb 29
    if (month === 1 && day === 29) {
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

      if (!isLeapYear) {
        // Use Feb 28 for non-leap years
        return new Date(year, 1, 28);
      }
    }

    return new Date(year, month, day);
  }

  /**
   * Format a UTC date to local time string for debugging
   *
   * @param utcDate - UTC date
   * @param timezone - Target timezone
   * @returns Formatted local time string
   */
  static formatLocalTime(utcDate: Date, timezone: string): string {
    return formatTZ(utcDate, 'yyyy-MM-dd HH:mm:ss zzz', { timeZone: timezone });
  }
}
