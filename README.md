# AquaFeed Pro - Backend API

Backend REST API for AquaFeed Pro, an intelligent fish feed formulation and farm management system for Nigerian aquaculture farmers.

## Features

- **Linear Programming Feed Optimizer** - Uses `javascript-lp-solver` to find the cheapest feed formulation
- **8-Parameter Nutritional Analysis** - Comprehensive nutrient tracking
- **Coppens Benchmarking** - Color-coded compliance (Red/Blue/Green)
- **Wallet & Payment System** - Paystack integration
- **Multi-Farm Management** - Support for multiple farms per user
- **Offline-Ready** - Session-based architecture for mobile apps
- **Email OTP Authentication** - Passwordless login

## Tech Stack

- **Runtime**: Node.js v20+
- **Framework**: Express.js 5.x
- **Language**: TypeScript
- **Database**: MongoDB (Mongoose ODM)
- **Session Store**: Redis
- **Email**: Nodemailer (Postmark/SendGrid)
- **Payments**: Paystack
- **File Storage**: Cloudinary

## Prerequisites

- Node.js v20+ and npm
- MongoDB (local or Atlas)
- Redis (local or Upstash)
- (Optional) Postmark/SendGrid API key for emails
- (Optional) Paystack account for payments

## Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
nano .env
```

## Environment Variables

```env
# MongoDB
MONGODB_URI=

# Redis
REDIS_URL=

# Session
SESSION_SECRET=

# Email
POSTMARK_API_KEY=

# Paystack
PAYSTACK_SECRET_KEY=
```

## Database Setup

### 1. Start MongoDB

```bash
# Local MongoDB
mongod --dbpath /path/to/data

# Or use MongoDB Atlas (cloud)
# Update MONGODB_URI in .env
```

### 2. Seed Ingredients Database

```bash
npm run seed
```

This imports 58 Nigerian fish feed ingredients with complete nutritional data.

## Running the Server

```bash
# Development (with hot reload)
npm run dev

# Production build
npm run build
npm start
```

Server will start on `http://localhost:5000`

**Health Check**: `http://localhost:5000/health`

## API Documentation

Once running, access Swagger docs at:
`http://localhost:5000/api/docs`

## Project Structure

```
backend/
├── src/
│   ├── api/              # API routes & controllers
│   ├── models/           # Mongoose schemas
│   ├── services/         # Business logic (solver, compliance, etc.)
│   ├── middleware/       # Auth, validation, error handling
│   ├── config/           # Database, Redis config
│   ├── utils/            # Helper functions
│   ├── scripts/          # Data seeding scripts
│   └── app.ts            # Express app entry point
├── dist/                 # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
└── .env
```

## Key Models

- **Ingredient** - 58 Nigerian feed ingredients with 8 nutritional parameters
- **FeedStandard** - Benchmark standards (Coppens, Blue Crown)
- **Formulation** - Feed calculation results (snapshot pattern)
- **User** - Farmers, admins, consultants
- **FarmProfile** - Multi-farm support with ponds
- **Transaction** - Wallet transactions

## Development

```bash
# Lint code
npm run lint

# Run tests
npm test

# Type check
npx tsc --noEmit
```

## Deployment

Recommended platforms:

- **DigitalOcean App Platform**
- **Render**
- **Railway**
- **AWS Elastic Beanstalk**

## License

ISC
