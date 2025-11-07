# 🚀 Quick Start Guide

## What Was Built

A **production-ready NestJS application** that sends birthday messages to users at exactly 9am in their local timezone, with complete implementation of:

✅ User management API (with soft deletes)
✅ Birthday scheduler (hourly CRON)
✅ Worker service (retry logic + DLQ)
✅ Recovery service (downtime handling)
✅ Notification system (strategy pattern)
✅ AWS integration (SQS + CloudWatch)
✅ Docker setup (production + development)

## 30-Second Test

```bash
# 1. Start services
./scripts/docker-setup.sh
# Choose option 2 (Development)

# 2. Create a user with birthday TODAY
curl -X POST http://localhost:3000/user \
  -H 'Content-Type: application/json' \
  -d '{
    "firstName": "Test",
    "lastName": "User",
    "birthday": "1990-11-07",
    "timezone": "America/New_York"
  }'

# 3. Manually trigger scheduling
curl -X POST http://localhost:3000/admin/birthday/schedule

# 4. Check if message was created
curl http://localhost:3000/admin/birthday/recovery-stats
```

## How It Works

### 1. Scheduler (Runs Every Hour)
```
Find users with birthday today
  ↓
Calculate 9am local time in UTC (DST-aware)
  ↓
Create BirthdayMessage record
  ↓
Push to SQS queue
```

### 2. Worker (Continuous Loop)
```
Claim message from queue (atomic)
  ↓
Validate user exists & data hasn't changed
  ↓
Send POST to hookbin.com
  ↓
Success: Mark as SENT
Failure: Retry (60s, 5min, 15min) or move to DLQ
```

### 3. Recovery (On Startup)
```
Find pending messages scheduled in the past
  ↓
Within 2 hours: Process immediately
Outside 2 hours: Mark as SKIPPED
```

## File Structure

```
src/
├── modules/
│   ├── user/                    # User CRUD API
│   │   ├── user.controller.ts
│   │   ├── user.service.ts
│   │   └── dto/
│   │
│   ├── birthday/                # Scheduling & processing
│   │   ├── scheduler/
│   │   │   ├── scheduler.service.ts   # Create messages
│   │   │   ├── worker.service.ts      # Process & deliver
│   │   │   └── recovery.service.ts    # Handle downtime
│   │   └── birthday.controller.ts     # Admin endpoints
│   │
│   ├── notification/            # Delivery system
│   │   ├── notification.service.ts    # Webhook delivery
│   │   └── handlers/
│   │       └── birthday-notification.handler.ts
│   │
│   ├── aws/                     # AWS services
│   │   ├── sqs.service.ts      # Queue management
│   │   └── cloudwatch.service.ts      # Metrics
│   │
│   └── health/                  # Health checks
│       └── health.controller.ts
│
├── common/utils/
│   ├── timezone.util.ts         # DST-aware calculations
│   └── logger.service.ts        # Structured logging
│
├── database/
│   ├── prisma.service.ts
│   └── database.module.ts
│
└── config/
    └── configuration.ts         # Environment config

prisma/
└── schema.prisma                # Database schema

docker-compose.yml               # Production setup
docker-compose.dev.yml           # Development setup
Dockerfile                       # Multi-stage build
```

## API Endpoints

### User Management
```bash
# Create user
POST /user
{
  "firstName": "John",
  "lastName": "Doe",
  "birthday": "1990-03-15",
  "timezone": "America/New_York"
}

# Get all users
GET /user

# Get specific user
GET /user/:id

# Update user
PUT /user/:id
{
  "firstName": "Jane",
  "timezone": "America/Los_Angeles"
}

# Soft delete user
DELETE /user/:id
```

### Admin Operations
```bash
# Manually trigger scheduling
POST /admin/birthday/schedule

# Manually trigger recovery
POST /admin/birthday/recover

# Get recovery statistics
GET /admin/birthday/recovery-stats
```

### Health Check
```bash
# Check system health
GET /health
```

## Environment Variables

### Required
```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/birthday_db"
HOOKBIN_URL="https://hookbin.com/your_bin_id"
```

### Optional (for AWS features)
```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
SQS_QUEUE_URL=...
SQS_DLQ_URL=...
```

### Feature Flags
```env
SCHEDULER_ENABLED=true    # Enable hourly scheduling
WORKER_ENABLED=true       # Enable message processing
RECOVERY_ENABLED=true     # Enable startup recovery
```

## Development Workflow

### 1. Start Development Environment
```bash
docker-compose -f docker-compose.dev.yml up -d
```

**Includes**:
- NestJS app with hot reload (port 3000)
- PostgreSQL database (port 5432)
- Redis for Bull queue (port 6379)
- Prisma Studio GUI (port 5555)

### 2. Watch Logs
```bash
docker-compose -f docker-compose.dev.yml logs -f app
```

### 3. Make Code Changes
- Edit files in `src/`
- Hot reload applies changes automatically

### 4. Run Database Migrations
```bash
docker-compose -f docker-compose.dev.yml exec app yarn prisma:migrate
```

### 5. Open Prisma Studio
```bash
docker-compose -f docker-compose.dev.yml up prisma-studio
# Navigate to http://localhost:5555
```

## Production Deployment

### 1. Build
```bash
docker-compose build
```

### 2. Start Services
```bash
docker-compose up -d
```

### 3. Run Migrations
```bash
docker-compose exec app npx prisma migrate deploy
```

### 4. Verify Health
```bash
curl http://localhost:3000/health
```

## Key Features

### DST Handling ✅
- Uses IANA timezones (`America/New_York`, not UTC offsets)
- Automatically adjusts for daylight saving time
- Validates timezones on user creation

### Retry Logic ✅
- Exponential backoff: 60s → 5min → 15min
- Max 3 retries (configurable)
- Dead Letter Queue for permanent failures

### Race Condition Prevention ✅
- `SELECT FOR UPDATE SKIP LOCKED` for atomic message claiming
- UNIQUE constraint on `(userId, scheduledFor)`
- Idempotency keys in webhook requests

### Stale Message Detection ✅
- Stores user snapshot at message creation
- Validates snapshot before delivery
- Skips messages if user data changed

### Grace Period Recovery ✅
- Processes messages <2 hours late
- Skips messages >2 hours late (too old to send)
- Manual recovery trigger available

## Monitoring

### CloudWatch Metrics
- `MessageDeliverySuccess` - Success/failure count
- `MessageDeliveryDuration` - Delivery latency
- `PendingMessageCount` - Queue depth
- `SchedulerMessagesCreated` - Scheduled count
- `WorkerMessagesProcessed` - Processed count
- `RecoveryMessagesRecovered` - Recovered count

### Logs
```bash
# Structured JSON logs with correlation IDs
docker-compose logs -f app

# Example log entry:
{
  "timestamp": "2024-11-07T10:00:00.000Z",
  "level": "info",
  "message": "Message delivered successfully",
  "messageId": "abc-123",
  "userId": "user-456",
  "durationMs": 250,
  "correlationId": "req-789"
}
```

## Troubleshooting

### Services won't start
```bash
docker-compose logs
docker-compose restart
```

### Database connection errors
```bash
docker-compose exec postgres pg_isready
docker-compose restart postgres
```

### No messages being scheduled
```bash
# Check scheduler is enabled
docker-compose exec app env | grep SCHEDULER_ENABLED

# Manually trigger
curl -X POST http://localhost:3000/admin/birthday/schedule

# Check logs
docker-compose logs -f app
```

### Messages not being delivered
```bash
# Check worker is enabled
docker-compose exec app env | grep WORKER_ENABLED

# Check queue depth
curl http://localhost:3000/admin/birthday/recovery-stats

# Check logs for errors
docker-compose logs -f app | grep ERROR
```

## Next Steps

1. **Set up AWS resources** (SQS, CloudWatch)
2. **Configure hookbin.com** endpoint
3. **Write tests** (unit, integration, E2E)
4. **Add authentication** for admin endpoints
5. **Set up monitoring** dashboard

## Documentation

- **Implementation Details**: `claudedocs/implementation-complete.md`
- **Docker Guide**: `claudedocs/docker-guide.md`
- **Architecture Review**: From initial brainstorming session

## Support

For issues or questions, check:
1. Service logs: `docker-compose logs -f app`
2. Health endpoint: `GET /health`
3. Recovery stats: `GET /admin/birthday/recovery-stats`
