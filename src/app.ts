import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
// import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import connectDatabase from './config/database';

// Load environment variables
dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 5000;

// Add Morgan Logger (dev mode)
import morgan from 'morgan';
app.use(morgan('dev'));

// ======================
// Middleware
// ======================

// Security headers with production-grade CSP configuration
app.use(
    helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                'default-src': ["'self'"],
                'script-src': [
                    "'self'",
                    "'unsafe-inline'", // Required for Scalar's inline logic
                    'https://cdn.jsdelivr.net', // Scalar CDN
                ],
                'style-src': [
                    "'self'",
                    "'unsafe-inline'", // Required for Scalar's styling
                    'https://cdn.jsdelivr.net',
                    'https://fonts.googleapis.com' // If Scalar loads fonts
                ],
                'font-src': [
                    "'self'",
                    'https://cdn.jsdelivr.net',
                    'https://fonts.gstatic.com',
                    'data:'
                ],
                'img-src': ["'self'", 'data:', 'https:'],
                'connect-src': ["'self'", 'https://cdn.jsdelivr.net'],
                'worker-src': ["'self'", 'blob:'], // Required for some editor features
                'object-src': ["'none'"], // Prevent object/embed injection
                'base-uri': ["'self'"],
                'form-action': ["'self'"],
                'frame-ancestors': ["'none'"], // Prevent clickjacking
                'upgrade-insecure-requests': [] // Force HTTPS
            },
        },
        crossOriginEmbedderPolicy: false, // Scalar resources are not COEP compatible yet
        crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow CDN resources
        hsts: {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true
        },
        frameguard: { action: 'deny' },
        noSniff: true,
        xssFilter: true
    })
);

// CORS configuration
const corsOptions = {
    origin: [
        process.env.FRONTEND_URL || 'http://localhost:3000',
        process.env.ADMIN_URL || 'http://localhost:3001',
        'http://localhost:3000', // Admin panel (Next.js default)
    ],
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
import session from 'express-session';
import MongoStore from 'connect-mongo';

app.use(session({
    secret: process.env.SESSION_SECRET || 'supersecret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/aquafeed',
        collectionName: 'sessions',
        ttl: 60 * 60 * 24 * 30 // 30 days
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production', // true in production
        httpOnly: true, // Prevents XSS access to cookie
        maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    }
}));

// Rate limiting
// const limiter = rateLimit({
//     windowMs: 15 * 60 * 1000, // 15 minutes
//     max: 100, // Limit each IP to 100 requests per windowMs
//     message: 'Too many requests from this IP, please try again later.'
// });
// app.use('/api/', limiter);

// Import routes
import ingredientRoutes from './api/ingredients/ingredient.routes';
import standardRoutes from './api/standards/standard.routes';
import formulationRoutes from './api/formulations/formulation.routes';
import authRoutes from './api/auth/auth.routes';
import financialRoutes from './api/financials/financial.routes';
import inventoryRoutes from './api/inventory/inventory.routes';
import batchRoutes from './api/batches/batch.routes';
import adminRoutes from './api/admin/admin.routes';
import paymentRoutes from './api/payment/payment.routes';
import { clerkAuth } from './middleware/clerk.middleware';
import { openApiSpec } from './config/swagger';
import { apiReference } from '@scalar/express-api-reference';

// ======================
// Routes
// ======================

// Serve OpenAPI Spec for Scalar
app.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(openApiSpec);
});

// API Documentation (Scalar)
app.use(
    '/api/docs',
    apiReference({
        theme: 'purple',
        spec: {
            url: '/openapi.json',
        },
        defaultHttpClient: {
            targetKey: 'node',
            clientKey: 'fetch',
        },
    })
);

// Health check
app.get('/health', (_req: Request, res: Response) => {
    res.json({
        status: 'UP',
        timestamp: new Date(),
        environment: process.env.NODE_ENV
    });
});

// API root
app.get('/api/v1', (_req: Request, res: Response) => {
    res.json({
        name: 'AquaFeed Pro API',
        version: '1.0.0',
        description: 'Backend API for Fish Feed Formulation ERP System',
        documentation: '/api/docs',
        endpoints: {
            ingredients: '/api/v1/ingredients',
            standards: '/api/v1/standards',
            formulations: '/api/v1/formulations'
        }
    });
});

// API Routes - Apply Clerk auth middleware for JWT verification
app.use('/api/v1', clerkAuth);

app.use('/api/v1/ingredients', ingredientRoutes);
app.use('/api/v1/standards', standardRoutes);
app.use('/api/v1/formulations', formulationRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/financials', financialRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/batches', batchRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/payments', paymentRoutes);

// ======================
// Error Handling
// ======================

// 404 handler
app.use((req: Request, res: Response) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
        timestamp: new Date().toISOString()
    });
});

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Error:', err);

    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    res.status(statusCode).json({
        error: err.name || 'Error',
        message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// ======================
// Server Startup
// ======================

const startServer = async () => {
    try {
        // Connect to MongoDB
        await connectDatabase();

        // Start Express server
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(60));
            console.log('🚀 AquaFeed Pro Backend Server Started');
            console.log('='.repeat(60));
            console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`Server running on: http://localhost:${PORT}`);
            console.log(`Health check: http://localhost:${PORT}/health`);
            console.log(`API endpoint: http://localhost:${PORT}/api/v1`);
            console.log('='.repeat(60) + '\n');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

// Start the server
startServer();

export default app;
