import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aquafeed';

const parseNumberEnv = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const parseBooleanEnv = (value: string | undefined, fallback: boolean) => {
    if (value === undefined) return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return fallback;
};

const sleep = async (ms: number) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

export const isDatabaseReady = (): boolean => mongoose.connection.readyState === 1;

export const isTransientMongoError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error || '');
    const lower = message.toLowerCase();
    const labels = (error as any)?.errorLabelSet;
    const hasResetLabel = typeof labels?.has === 'function'
        ? (labels.has('ResetPool') || labels.has('InterruptInUseConnections') || labels.has('PoolRequstedRetry'))
        : false;

    return hasResetLabel
        || lower.includes('poolclearedonnetworkerror')
        || lower.includes('mongonetworktimeout')
        || lower.includes('server selection timed out')
        || lower.includes('econnreset')
        || lower.includes('etimedout')
        || lower.includes('topology was destroyed')
        || lower.includes('connection <monitor>');
};

export const getMongoClientOptions = () => {
    const ipv4Only = parseBooleanEnv(process.env.MONGODB_IPV4_ONLY, true);
    return {
        connectTimeoutMS: parseNumberEnv(process.env.MONGODB_CONNECT_TIMEOUT_MS, 15000),
        serverSelectionTimeoutMS: parseNumberEnv(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 20000),
        socketTimeoutMS: parseNumberEnv(process.env.MONGODB_SOCKET_TIMEOUT_MS, 45000),
        heartbeatFrequencyMS: parseNumberEnv(process.env.MONGODB_HEARTBEAT_MS, 10000),
        maxPoolSize: parseNumberEnv(process.env.MONGODB_MAX_POOL_SIZE, 20),
        minPoolSize: parseNumberEnv(process.env.MONGODB_MIN_POOL_SIZE, 2),
        retryWrites: true,
        appName: 'aquafeed-backend',
        ...(ipv4Only ? { family: 4 as const } : {})
    };
};

let listenersAttached = false;

const attachConnectionListeners = () => {
    if (listenersAttached) return;
    listenersAttached = true;

    mongoose.connection.on('connected', () => {
        console.log('MongoDB connected');
    });

    mongoose.connection.on('error', (err) => {
        console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
        console.warn('MongoDB disconnected');
    });

    process.on('SIGINT', async () => {
        await mongoose.connection.close();
        console.log('MongoDB connection closed due to app termination');
        process.exit(0);
    });
};

export const connectDatabase = async (): Promise<void> => {
    const maxAttempts = parseNumberEnv(process.env.MONGODB_RETRY_ATTEMPTS, 5);
    const baseDelayMs = parseNumberEnv(process.env.MONGODB_RETRY_DELAY_MS, 2000);

    console.log('Connecting to MongoDB...');
    attachConnectionListeners();

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await mongoose.connect(MONGODB_URI, getMongoClientOptions());
            console.log('✓ MongoDB connected successfully');
            console.log(`  Database: ${mongoose.connection.name}`);
            console.log(`  Host: ${mongoose.connection.host}`);
            return;
        } catch (error) {
            lastError = error;
            const retryable = isTransientMongoError(error);
            const isLastAttempt = attempt === maxAttempts;
            const waitMs = Math.min(baseDelayMs * Math.pow(2, attempt - 1), 15000);

            console.error(`MongoDB connect attempt ${attempt}/${maxAttempts} failed`, error);
            if (!retryable || isLastAttempt) break;

            console.warn(`Retrying MongoDB connection in ${waitMs}ms...`);
            await sleep(waitMs);
        }
    }

    console.error('Error connecting to MongoDB:', lastError);
    process.exit(1);
};

export default connectDatabase;
