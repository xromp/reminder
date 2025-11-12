#!/usr/bin/env ts-node

/**
 * Manual End-to-End Test Script for Birthday Flow
 * 
 * Run with: npx ts-node scripts/test-birthday-flow.ts
 * 
 * This script:
 * 1. Creates a test user with birthday tomorrow
 * 2. Creates a RecurringEvent for the birthday
 * 3. Runs the scheduler to create ScheduledNotification
 * 4. Displays the job envelope that would be sent to SQS
 * 5. Shows the complete flow status
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { EventSchedulerService } from '../src/modules/events/event-scheduler.service';
import { addDays, format } from 'date-fns';
import { EventType } from '@prisma/client';

async function main() {
  console.log('🚀 Starting Birthday Flow Test\n');

  // Create NestJS application
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const scheduler = app.get(EventSchedulerService);

  try {
    // Step 1: Create test user
    console.log('📝 Step 1: Creating test user...');
    const tomorrow = addDays(new Date(), 1);
    
    const user = await prisma.user.create({
      data: {
        firstName: 'Alice',
        lastName: 'Smith',
        birthday: tomorrow,
        timezone: 'America/New_York',
        birthdayMonth: parseInt(format(tomorrow, 'M')),
        birthdayDay: parseInt(format(tomorrow, 'dd')),
      },
    });

    console.log('✅ Created user:', {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`,
      birthday: format(user.birthday, 'yyyy-MM-dd'),
      timezone: user.timezone,
    });
    console.log();

    // Step 2: Create recurring birthday event
    console.log('📝 Step 2: Creating recurring birthday event...');
    const fixedYearDate = new Date(2000, tomorrow.getMonth(), tomorrow.getDate());

    const event = await prisma.recurringEvent.create({
      data: {
        userId: user.id,
        type: EventType.BIRTHDAY,
        eventDate: fixedYearDate,
        notificationTime: '09:00:00',
        enabled: true,
      },
    });

    console.log('✅ Created recurring event:', {
      id: event.id,
      type: event.type,
      eventDate: format(event.eventDate, 'MM-dd'),
      notificationTime: event.notificationTime,
      enabled: event.enabled,
    });
    console.log();

    // Step 3: Run scheduler
    console.log('📝 Step 3: Running scheduler...');
    const scheduled = await scheduler.scheduleUpcomingOccurrences();
    console.log(`   Scheduled ${scheduled} occurrence(s)`);

    // Check for created notifications
    const notifications = await prisma.scheduledNotification.findMany({
      where: {
        eventId: event.id,
      },
    });

    if (notifications.length === 0) {
      console.log('⚠️  No notifications created. This might be expected if:');
      console.log('   - The birthday is not within the scheduling window');
      console.log('   - SCHEDULER_ENABLED is false');
      console.log('   - The notification already exists');
    } else {
      console.log('✅ Scheduler created notifications:', notifications.length);
      notifications.forEach((notif, index) => {
        console.log(`   Notification ${index + 1}:`, {
          id: notif.id,
          scheduledFor: notif.scheduledFor.toISOString(),
          status: notif.status,
          retryCount: notif.retryCount,
        });
      });
    }
    console.log();

    // Step 4: Show what would be in SQS
    console.log('📝 Step 4: Job Envelope (sent to SQS):');
    const year = tomorrow.getFullYear();
    const scheduledFor = new Date(year, tomorrow.getMonth(), tomorrow.getDate(), 9, 0, 0);

    const envelope = {
      type: 'BIRTHDAY_NOTIFICATION',
      version: 1,
      idempotencyKey: `event:${event.id}:${year}`,
      payload: {
        eventId: event.id,
        userId: user.id,
        scheduledFor: scheduledFor.toISOString(),
        eventType: 'BIRTHDAY',
        year,
      },
    };

    console.log(JSON.stringify(envelope, null, 2));
    console.log();

    // Step 5: Summary
    console.log('📊 Summary:');
    console.log('✅ User created:', user.id);
    console.log('✅ Event created:', event.id);
    console.log('✅ Notifications scheduled:', notifications.length);
    console.log();

    // Step 6: Verification
    console.log('🔍 Verification queries:');
    console.log(`SELECT * FROM users WHERE id = '${user.id}';`);
    console.log(`SELECT * FROM recurring_events WHERE id = '${event.id}';`);
    console.log(`SELECT * FROM scheduled_notifications WHERE event_id = '${event.id}';`);
    console.log();

    // Keep the data for manual testing
    console.log('💡 To test the worker:');
    console.log('   1. Ensure SQS is running (LocalStack or AWS)');
    console.log('   2. Set WORKER_ENABLED=true in .env');
    console.log('   3. Start the application: npm run start:dev');
    console.log('   4. Watch the logs for job processing');
    console.log();

    console.log('🧹 To clean up test data:');
    console.log(`   DELETE FROM scheduled_notifications WHERE event_id = '${event.id}';`);
    console.log(`   DELETE FROM recurring_events WHERE id = '${event.id}';`);
    console.log(`   DELETE FROM users WHERE id = '${user.id}';`);
    console.log();

    console.log('✨ Test completed successfully!');

  } catch (error) {
    console.error('❌ Error during test:', error);
    throw error;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

