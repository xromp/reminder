# Docker Deployment Guide

## 📦 What's Included

### Production Setup (`docker-compose.yml`)
- **NestJS Application** - Multi-stage optimized build
- **PostgreSQL 15** - Database with persistent volume
- **Redis 7** - Bull queue backend
- **Health Checks** - All services monitored
- **Security** - Non-root user, minimal attack surface

### Development Setup (`docker-compose.dev.yml`)
- **Hot Reload** - Source code mounted for live updates
- **Debug Port** - Port 9229 for Node.js debugging
- **Prisma Studio** - Database GUI on port 5555
- **Development Tools** - All dev dependencies included

## 🚀 Quick Start

### Automated Setup (Recommended)

```bash
# Run the setup script
./scripts/docker-setup.sh

# Follow prompts:
# 1. Choose production or development
# 2. Script will build, migrate, and start services
```

### Manual Setup

#### Production

```bash
# 1. Configure environment
cp .env.docker .env
# Edit .env with your settings

# 2. Build and start services
docker-compose up -d

# 3. Run database migrations
docker-compose exec app npx prisma migrate deploy

# 4. Verify services are running
docker-compose ps

# 5. Test API
curl http://localhost:3000/health
```

#### Development

```bash
# 1. Configure environment
cp .env.docker .env

# 2. Start development environment
docker-compose -f docker-compose.dev.yml up -d

# 3. Watch logs
docker-compose -f docker-compose.dev.yml logs -f app

# 4. Open Prisma Studio (optional)
docker-compose -f docker-compose.dev.yml up prisma-studio
# Navigate to http://localhost:5555
```

## 🔧 Common Commands

### Service Management

```bash
# Start all services
docker-compose up -d

# Start specific service
docker-compose up -d app

# Stop all services
docker-compose down

# Stop and remove volumes (WARNING: deletes data)
docker-compose down -v

# Restart a service
docker-compose restart app

# View service status
docker-compose ps
```

### Logs & Debugging

```bash
# View all logs
docker-compose logs

# Follow app logs
docker-compose logs -f app

# View last 100 lines
docker-compose logs --tail=100 app

# View PostgreSQL logs
docker-compose logs postgres

# Execute shell in container
docker-compose exec app sh

# Execute command in container
docker-compose exec app yarn prisma:studio
```

### Database Operations

```bash
# Run Prisma migrations
docker-compose exec app npx prisma migrate deploy

# Create new migration
docker-compose exec app npx prisma migrate dev --name migration_name

# Reset database (WARNING: deletes all data)
docker-compose exec app npx prisma migrate reset

# Generate Prisma client
docker-compose exec app npx prisma generate

# Open Prisma Studio
docker-compose exec app npx prisma studio
# Or use the dedicated service:
docker-compose -f docker-compose.dev.yml up prisma-studio
```

### Development Workflow

```bash
# Start development environment
docker-compose -f docker-compose.dev.yml up -d

# Make code changes (hot reload enabled)
# Edit files in src/

# View live logs
docker-compose -f docker-compose.dev.yml logs -f app

# Rebuild after package.json changes
docker-compose -f docker-compose.dev.yml down
docker-compose -f docker-compose.dev.yml build
docker-compose -f docker-compose.dev.yml up -d

# Run tests
docker-compose -f docker-compose.dev.yml exec app yarn test

# Run migrations
docker-compose -f docker-compose.dev.yml exec app yarn prisma:migrate
```

## 🏗️ Multi-Stage Build Explained

### Dockerfile Stages

```dockerfile
# Stage 1: Builder - Compiles TypeScript
FROM node:20-alpine AS builder
# Installs all dependencies and builds dist/

# Stage 2: Dependencies - Production deps only
FROM node:20-alpine AS dependencies
# Installs production dependencies (no devDependencies)

# Stage 3: Production - Final minimal image
FROM node:20-alpine AS production
# Copies only dist/, node_modules, and Prisma client
# Uses non-root user for security
# Includes health check
```

**Benefits**:
- ✅ Small image size (~200MB vs ~800MB with dev deps)
- ✅ Fast deployment (no TypeScript compilation needed)
- ✅ Secure (non-root user, minimal surface)
- ✅ Production-optimized (only runtime dependencies)

## 🔐 Security Features

### Non-Root User

```dockerfile
# Create user with UID 1001
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Switch to non-root
USER nestjs
```

**Why**: Limits potential damage if container is compromised

### Dumb-Init

```dockerfile
RUN apk add --no-cache dumb-init
ENTRYPOINT ["dumb-init", "--"]
```

**Why**: Properly handles signals (SIGTERM, SIGINT) for graceful shutdown

### Health Checks

```yaml
healthcheck:
  test: ["CMD-SHELL", "wget --spider http://localhost:3000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

**Why**: Docker can detect and restart unhealthy containers

## 📊 Environment Variables

### Required Variables

```env
# Database
DATABASE_URL=postgresql://postgres:password@postgres:5432/birthday_db

# Application
NODE_ENV=production
PORT=3000

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
```

### Optional Variables

```env
# AWS (only if using SQS/CloudWatch)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret

# Webhook
HOOKBIN_URL=https://hookbin.com/your_bin_id

# Features
SCHEDULER_ENABLED=false
WORKER_ENABLED=false
RECOVERY_ENABLED=false
```

## 🗄️ Data Persistence

### Volumes

```yaml
volumes:
  postgres_data:  # PostgreSQL data
  redis_data:     # Redis persistence
```

### Backup Database

```bash
# Export database
docker-compose exec postgres pg_dump -U postgres birthday_db > backup.sql

# Import database
docker-compose exec -T postgres psql -U postgres birthday_db < backup.sql
```

## 🚦 Port Mapping

| Service | Internal Port | External Port | Purpose |
|---------|---------------|---------------|---------|
| App | 3000 | 3000 | REST API |
| App (debug) | 9229 | 9229 | Node.js debugger (dev only) |
| PostgreSQL | 5432 | 5432 | Database |
| Redis | 6379 | 6379 | Queue backend |
| Prisma Studio | 5555 | 5555 | Database GUI (dev only) |

## 🐛 Troubleshooting

### Services won't start

```bash
# Check logs for errors
docker-compose logs

# Check service health
docker-compose ps

# Restart services
docker-compose restart
```

### Database connection errors

```bash
# Verify PostgreSQL is healthy
docker-compose exec postgres pg_isready

# Check DATABASE_URL is correct
docker-compose exec app env | grep DATABASE_URL

# Restart PostgreSQL
docker-compose restart postgres
```

### Port already in use

```bash
# Change port in .env
PORT=3001

# Or find process using port
lsof -i :3000
kill -9 <PID>
```

### Out of disk space

```bash
# Remove unused Docker resources
docker system prune -a --volumes

# Check disk usage
docker system df
```

### Migrations fail

```bash
# Reset database (WARNING: deletes data)
docker-compose down -v
docker-compose up -d postgres
docker-compose exec app npx prisma migrate deploy

# Or manually fix
docker-compose exec app npx prisma migrate resolve --rolled-back <migration_name>
```

## 📈 Production Deployment

### AWS ECS Deployment

```bash
# 1. Build and push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com

docker build -t birthday-app .
docker tag birthday-app:latest <account>.dkr.ecr.us-east-1.amazonaws.com/birthday-app:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/birthday-app:latest

# 2. Update ECS task definition
# 3. Deploy to ECS service
```

### Environment-Specific Builds

```bash
# Production
docker build --target production -t birthday-app:prod .

# Development
docker build --target development -f Dockerfile.dev -t birthday-app:dev .
```

### Health Check Verification

```bash
# Test health endpoint
curl http://localhost:3000/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:00:00.000Z",
  "checks": {
    "database": true,
    "memory": true,
    "uptime": 123.45
  }
}
```

## 🔄 CI/CD Integration

### GitHub Actions Example

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Build Docker image
        run: docker build -t birthday-app .

      - name: Run tests
        run: |
          docker-compose up -d postgres redis
          docker-compose run --rm app yarn test

      - name: Push to registry
        run: |
          docker tag birthday-app ${{ secrets.REGISTRY }}/birthday-app:${{ github.sha }}
          docker push ${{ secrets.REGISTRY }}/birthday-app:${{ github.sha }}
```

## 📚 Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)
- [Health Checks](https://docs.docker.com/engine/reference/builder/#healthcheck)
- [Prisma with Docker](https://www.prisma.io/docs/guides/deployment/deployment-guides/deploying-to-docker)
