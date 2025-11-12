#!/bin/bash
set -e

echo "🚀 Initializing LocalStack AWS resources..."

# Wait for LocalStack to be ready
echo "⏳ Waiting for LocalStack to be fully ready..."
sleep 2

# Define queue names
QUEUE_NAME="birthday-notifications.fifo"
DLQ_NAME="birthday-notifications-dlq.fifo"

# Create Dead Letter Queue (DLQ)
echo "📦 Creating DLQ: $DLQ_NAME"
awslocal sqs create-queue \
  --queue-name "$DLQ_NAME" \
  --attributes FifoQueue=true,ContentBasedDeduplication=true \
  --region us-east-1

# Get ARN using the LocalStack-returned URL (needed for queue creation)
DLQ_URL_RAW=$(awslocal sqs get-queue-url --queue-name "$DLQ_NAME" --region us-east-1 --query 'QueueUrl' --output text)
DLQ_ARN=$(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL_RAW" --attribute-names QueueArn --region us-east-1 --query 'Attributes.QueueArn' --output text)

# Construct Docker-internal URL for use by app containers
DLQ_URL="http://localstack:4566/000000000000/$DLQ_NAME"

echo "✅ DLQ created: $DLQ_URL"
echo "   ARN: $DLQ_ARN"

# Create Main Queue with DLQ
echo "📦 Creating main queue: $QUEUE_NAME"
awslocal sqs create-queue \
  --queue-name "$QUEUE_NAME" \
  --attributes "{
    \"FifoQueue\": \"true\",
    \"ContentBasedDeduplication\": \"true\",
    \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"
  }" \
  --region us-east-1

# Construct Docker-internal URL for use by app containers
QUEUE_URL="http://localstack:4566/000000000000/$QUEUE_NAME"

echo "✅ Main queue created: $QUEUE_URL"

# Display summary
echo ""
echo "═══════════════════════════════════════════════════════"
echo "🎉 LocalStack initialization complete!"
echo "═══════════════════════════════════════════════════════"
echo "Main Queue URL:  $QUEUE_URL"
echo "DLQ URL:         $DLQ_URL"
echo ""
echo "💡 Set these in your .env file:"
echo "   SQS_QUEUE_URL=$QUEUE_URL"
echo "   SQS_DLQ_URL=$DLQ_URL"
echo "   AWS_ENDPOINT_URL=http://localstack:4566"
echo "═══════════════════════════════════════════════════════"

