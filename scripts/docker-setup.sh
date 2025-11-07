#!/bin/bash

# Birthday Notification Service - Docker Setup Script

set -e

echo "🎂 Birthday Notification Service - Docker Setup"
echo "================================================"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from .env.docker..."
    cp .env.docker .env
    echo "✅ .env file created. Please update it with your configuration."
else
    echo "✅ .env file already exists."
fi

# Ask user which environment to set up
echo ""
echo "Which environment do you want to set up?"
echo "1) Production (docker-compose.yml)"
echo "2) Development with hot reload (docker-compose.dev.yml)"
read -p "Enter choice [1-2]: " choice

case $choice in
    1)
        COMPOSE_FILE="docker-compose.yml"
        ENV="production"
        ;;
    2)
        COMPOSE_FILE="docker-compose.dev.yml"
        ENV="development"
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "🚀 Setting up $ENV environment..."

# Build images
echo "📦 Building Docker images..."
docker-compose -f $COMPOSE_FILE build

# Start services
echo "🔧 Starting services..."
docker-compose -f $COMPOSE_FILE up -d postgres redis

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
sleep 5

# Run Prisma migrations
echo "🗄️  Running database migrations..."
if [ "$ENV" = "production" ]; then
    docker-compose -f $COMPOSE_FILE run --rm app sh -c "npx prisma migrate deploy"
else
    docker-compose -f $COMPOSE_FILE run --rm app sh -c "yarn prisma:migrate"
fi

# Start application
echo "🚀 Starting application..."
docker-compose -f $COMPOSE_FILE up -d app

# Show status
echo ""
echo "✅ Setup complete!"
echo ""
echo "Services:"
docker-compose -f $COMPOSE_FILE ps

echo ""
echo "📊 Access points:"
echo "  - API: http://localhost:3000"
echo "  - Health: http://localhost:3000/health"
echo "  - PostgreSQL: localhost:5432"
echo "  - Redis: localhost:6379"
if [ "$ENV" = "development" ]; then
    echo "  - Prisma Studio: http://localhost:5555"
fi

echo ""
echo "📝 Useful commands:"
echo "  - View logs: docker-compose -f $COMPOSE_FILE logs -f app"
echo "  - Stop services: docker-compose -f $COMPOSE_FILE down"
echo "  - Restart app: docker-compose -f $COMPOSE_FILE restart app"
if [ "$ENV" = "development" ]; then
    echo "  - Open Prisma Studio: docker-compose -f $COMPOSE_FILE up prisma-studio"
fi

echo ""
echo "🎉 Ready to go! Try creating a user:"
echo ""
echo "curl -X POST http://localhost:3000/user \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{"
echo "    \"firstName\": \"John\","
echo "    \"lastName\": \"Doe\","
echo "    \"birthday\": \"1990-03-15\","
echo "    \"timezone\": \"America/New_York\""
echo "  }'"
