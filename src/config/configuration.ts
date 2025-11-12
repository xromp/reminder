export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL,
  },

  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.AWS_ENDPOINT_URL,
  },

  sqs: {
    queueUrl: process.env.SQS_QUEUE_URL,
    dlqUrl: process.env.SQS_DLQ_URL,
  },

  webhook: {
    hookbinUrl: process.env.HOOKBIN_URL,
  },

  scheduler: {
    enabled: process.env.SCHEDULER_ENABLED === 'true',
  },

  worker: {
    enabled: process.env.WORKER_ENABLED === 'true',
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '10', 10),
    pollInterval: parseInt(process.env.WORKER_POLL_INTERVAL || '5000', 10),
    visibilityTimeout: parseInt(process.env.WORKER_VISIBILITY_TIMEOUT || '30', 10),
  },

  recovery: {
    enabled: process.env.RECOVERY_ENABLED === 'true',
    gracePeriodMinutes: parseInt(process.env.GRACE_PERIOD_MINUTES || '120', 10),
  },

  retry: {
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    delaySeconds: (process.env.RETRY_DELAY_SECONDS || '60,300,900')
      .split(',')
      .map((d) => parseInt(d, 10)),
  },

  cloudwatch: {
    namespace: process.env.CLOUDWATCH_NAMESPACE || 'BirthdayNotifications',
  },

  smtp: {
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '1025', 10),
    secure: process.env.SMTP_SECURE === 'true',
    from: {
      email: process.env.SMTP_FROM_EMAIL || 'noreply@reminder.local',
      name: process.env.SMTP_FROM_NAME || 'Reminder App',
    },
  },
});
