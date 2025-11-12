import {
  nextOccurrence,
  isLeapYear,
  LeapYearPolicy,
  RecurringEventInput,
} from './next-occurrence.util';
import { getYear, getMonth, getDate } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

describe('nextOccurrence', () => {
  describe('AC1: Basic next occurrence calculation', () => {
    it('should return next occurrence in UTC for user timezone', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 1, 14), // Feb 14
        notificationTime: '09:00:00',
      };
      const fromDate = new Date(2025, 0, 1); // Jan 1, 2025
      const result = nextOccurrence(event, fromDate, 'America/New_York');

      // Should return Feb 14, 2025 at 9:00 AM EST (14:00 UTC)
      expect(getYear(result)).toBe(2025);
      expect(getMonth(result)).toBe(1); // February (0-indexed)
      expect(getDate(result)).toBe(14);

      // Verify it's in UTC and represents 9 AM NY time
      const localTime = formatInTimeZone(result, 'America/New_York', 'HH:mm:ss');
      expect(localTime).toBe('09:00:00');
    });

    it('should handle different timezones correctly', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 11, 25), // Dec 25
        notificationTime: '10:00:00',
      };
      const fromDate = new Date(2025, 0, 1);

      const resultNY = nextOccurrence(event, fromDate, 'America/New_York');
      const resultLA = nextOccurrence(event, fromDate, 'America/Los_Angeles');
      const resultLondon = nextOccurrence(event, fromDate, 'Europe/London');

      // All should be Dec 25, 2025, but different UTC times
      expect(getMonth(resultNY)).toBe(11);
      expect(getMonth(resultLA)).toBe(11);
      expect(getMonth(resultLondon)).toBe(11);

      // LA is 3 hours behind NY, so UTC time should be 3 hours later
      expect(resultLA.getTime() - resultNY.getTime()).toBe(3 * 60 * 60 * 1000);
    });
  });

  describe('AC2: Leap year policy for Feb 29', () => {
    it('should return Feb 29 in a leap year', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 1, 29), // Feb 29
        notificationTime: '09:00:00',
      };
      const fromDate = new Date(2024, 0, 1); // 2024 is a leap year
      const result = nextOccurrence(event, fromDate, 'America/New_York');

      expect(getYear(result)).toBe(2024);
      expect(getMonth(result)).toBe(1); // February
      expect(getDate(result)).toBe(29);
    });

    it('should return Feb 28 in a non-leap year (default policy)', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 1, 29), // Feb 29
        notificationTime: '09:00:00',
      };
      const fromDate = new Date(2025, 0, 1); // 2025 is NOT a leap year
      const result = nextOccurrence(event, fromDate, 'America/New_York');

      expect(getYear(result)).toBe(2025);
      expect(getMonth(result)).toBe(1); // February
      expect(getDate(result)).toBe(28); // Falls back to Feb 28
    });

    it('should respect explicit USE_FEB_28 policy', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 1, 29), // Feb 29
        notificationTime: '09:00:00',
      };
      const fromDate = new Date(2025, 0, 1);
      const result = nextOccurrence(
        event,
        fromDate,
        'America/New_York',
        LeapYearPolicy.USE_FEB_28,
      );

      expect(getDate(result)).toBe(28);
    });
  });

  describe('AC3: Current date before this year occurrence', () => {
    it('should return this year occurrence when fromDate is before it', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 11, 31), // Dec 31
        notificationTime: '09:00:00',
      };
      const fromDate = new Date(2025, 0, 1); // Jan 1, 2025
      const result = nextOccurrence(event, fromDate, 'America/New_York');

      expect(getYear(result)).toBe(2025); // Same year
      expect(getMonth(result)).toBe(11); // December
      expect(getDate(result)).toBe(31);
    });

    it('should return this year for event later in current month', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 5, 15), // Jun 15
        notificationTime: '09:00:00',
      };
      const fromDate = new Date(2025, 5, 10); // Jun 10, 2025
      const result = nextOccurrence(event, fromDate, 'America/New_York');

      expect(getYear(result)).toBe(2025);
      expect(getMonth(result)).toBe(5);
      expect(getDate(result)).toBe(15);
    });
  });

  describe('AC4: Current date after this year occurrence', () => {
    it('should return next year occurrence when fromDate is after it', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 0, 1), // Jan 1
        notificationTime: '09:00:00',
      };
      const fromDate = new Date(2025, 11, 31, 23, 59); // Dec 31, 2025 at 11:59 PM
      const result = nextOccurrence(event, fromDate, 'America/New_York');

      expect(getYear(result)).toBe(2026); // Next year
      expect(getMonth(result)).toBe(0); // January
      expect(getDate(result)).toBe(1);
    });

    it('should handle year boundary correctly', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 2, 15), // Mar 15
        notificationTime: '09:00:00',
      };
      const fromDate = new Date(2025, 2, 16); // Mar 16, 2025 (after event)
      const result = nextOccurrence(event, fromDate, 'America/New_York');

      expect(getYear(result)).toBe(2026); // Next year
    });
  });

  describe('AC5: DST transitions', () => {
    it('should handle spring forward (2 AM doesn exist)', () => {
      // In 2025, DST starts March 9 at 2 AM in America/New_York
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 2, 9), // Mar 9
        notificationTime: '09:00:00', // 9 AM (after spring forward)
      };
      const fromDate = new Date(2025, 0, 1);
      const result = nextOccurrence(event, fromDate, 'America/New_York');

      // Should still return 9 AM local time, correctly converted to UTC
      const localTime = formatInTimeZone(result, 'America/New_York', 'HH:mm:ss');
      expect(localTime).toBe('09:00:00');
      expect(getDate(result)).toBe(9);
    });

    it('should handle fall back (2 AM happens twice)', () => {
      // In 2025, DST ends November 2 at 2 AM in America/New_York
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 10, 2), // Nov 2
        notificationTime: '09:00:00',
      };
      const fromDate = new Date(2025, 0, 1);
      const result = nextOccurrence(event, fromDate, 'America/New_York');

      // Should return 9 AM local time, correctly converted to UTC
      const localTime = formatInTimeZone(result, 'America/New_York', 'HH:mm:ss');
      expect(localTime).toBe('09:00:00');
      expect(getDate(result)).toBe(2);
    });

    it('should maintain consistent local time across DST boundaries', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 6, 4), // Jul 4 (in DST)
        notificationTime: '09:00:00',
      };
      const fromDate = new Date(2025, 0, 1);
      const resultSummer = nextOccurrence(event, fromDate, 'America/New_York');

      const event2: RecurringEventInput = {
        eventDate: new Date(2000, 11, 25), // Dec 25 (not in DST)
        notificationTime: '09:00:00',
      };
      const resultWinter = nextOccurrence(event2, fromDate, 'America/New_York');

      // Both should be 9 AM local time
      const summerLocal = formatInTimeZone(resultSummer, 'America/New_York', 'HH:mm:ss');
      const winterLocal = formatInTimeZone(resultWinter, 'America/New_York', 'HH:mm:ss');
      
      expect(summerLocal).toBe('09:00:00');
      expect(winterLocal).toBe('09:00:00');

      // But UTC times should differ by 1 hour due to DST
      const utcDiff = Math.abs(resultSummer.getHours() - resultWinter.getHours());
      expect(utcDiff).toBe(1);
    });
  });

  describe('Edge cases', () => {
    it('should handle Dec 31 to Jan 1 boundary', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 0, 1), // Jan 1
        notificationTime: '00:00:00',
      };
      const fromDate = new Date(2025, 11, 31, 12, 0); // Dec 31, 2025 at noon
      const result = nextOccurrence(event, fromDate, 'America/New_York');

      expect(getYear(result)).toBe(2026);
      expect(getMonth(result)).toBe(0);
      expect(getDate(result)).toBe(1);
    });

    it('should handle Feb 28 in non-leap year', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 1, 28), // Feb 28
        notificationTime: '09:00:00',
      };
      const fromDate = new Date(2025, 0, 1);
      const result = nextOccurrence(event, fromDate, 'America/New_York');

      expect(getMonth(result)).toBe(1);
      expect(getDate(result)).toBe(28);
    });

    it('should handle different notification times', () => {
      const eventMorning: RecurringEventInput = {
        eventDate: new Date(2000, 5, 15),
        notificationTime: '06:00:00',
      };
      const eventEvening: RecurringEventInput = {
        eventDate: new Date(2000, 5, 15),
        notificationTime: '18:00:00',
      };
      const fromDate = new Date(2025, 0, 1);

      const resultMorning = nextOccurrence(eventMorning, fromDate, 'America/New_York');
      const resultEvening = nextOccurrence(eventEvening, fromDate, 'America/New_York');

      // Should be 12 hours apart
      expect(resultEvening.getTime() - resultMorning.getTime()).toBe(12 * 60 * 60 * 1000);
      
      // Verify both are for June 15
      const morningLocal = formatInTimeZone(resultMorning, 'America/New_York', 'yyyy-MM-dd');
      const eveningLocal = formatInTimeZone(resultEvening, 'America/New_York', 'yyyy-MM-dd');
      expect(morningLocal).toBe('2025-06-15');
      expect(eveningLocal).toBe('2025-06-15');
    });
  });

  describe('Error handling', () => {
    it('should throw error for invalid timezone', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 0, 1),
        notificationTime: '09:00:00',
      };
      const fromDate = new Date(2025, 0, 1);

      expect(() => {
        nextOccurrence(event, fromDate, 'Invalid/Timezone');
      }).toThrow('Invalid timezone');
    });
  });

  describe('Multiple timezones', () => {
    it('should work with Europe/London', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 3, 23), // Apr 23
        notificationTime: '10:00:00',
      };
      const fromDate = new Date(2025, 0, 1);
      const result = nextOccurrence(event, fromDate, 'Europe/London');

      const localTime = formatInTimeZone(result, 'Europe/London', 'HH:mm:ss');
      expect(localTime).toBe('10:00:00');
    });

    it('should work with Asia/Tokyo', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 7, 15), // Aug 15
        notificationTime: '08:00:00',
      };
      const fromDate = new Date(2025, 0, 1);
      const result = nextOccurrence(event, fromDate, 'Asia/Tokyo');

      const localTime = formatInTimeZone(result, 'Asia/Tokyo', 'HH:mm:ss');
      expect(localTime).toBe('08:00:00');
    });

    it('should work with Australia/Sydney', () => {
      const event: RecurringEventInput = {
        eventDate: new Date(2000, 11, 25), // Dec 25
        notificationTime: '07:00:00',
      };
      const fromDate = new Date(2025, 0, 1);
      const result = nextOccurrence(event, fromDate, 'Australia/Sydney');

      const localTime = formatInTimeZone(result, 'Australia/Sydney', 'HH:mm:ss');
      expect(localTime).toBe('07:00:00');
    });
  });
});

describe('isLeapYear', () => {
  it('should correctly identify leap years', () => {
    expect(isLeapYear(2020)).toBe(true);
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2000)).toBe(true); // Divisible by 400
    expect(isLeapYear(2400)).toBe(true);
  });

  it('should correctly identify non-leap years', () => {
    expect(isLeapYear(2021)).toBe(false);
    expect(isLeapYear(2022)).toBe(false);
    expect(isLeapYear(2023)).toBe(false);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(1900)).toBe(false); // Divisible by 100 but not 400
    expect(isLeapYear(2100)).toBe(false);
  });
});

