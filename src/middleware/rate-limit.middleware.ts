import { Request } from 'express';
import rateLimit from 'express-rate-limit';

const toPositiveInt = (raw: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(String(raw ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toWindowMs = (raw: string | undefined, fallbackMs: number): number => {
    const parsed = Number.parseInt(String(raw ?? ''), 10);
    return Number.isFinite(parsed) && parsed >= 1000 ? parsed : fallbackMs;
};

const extractEmail = (req: Request): string => {
    const email = req.body?.email;
    if (typeof email !== 'string') return 'unknown';
    const normalized = email.trim().toLowerCase();
    return normalized || 'unknown';
};

const rateLimitResponse = {
    error: 'Too many requests. Please wait and try again.'
};

// High ceiling so regular app usage is unaffected; blocks abusive spikes.
export const apiLimiter = rateLimit({
    windowMs: toWindowMs(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: toPositiveInt(process.env.RATE_LIMIT_MAX, 800),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => (
        req.path === '/payments/webhook'
        || req.path === '/payment/webhook'
        || req.path === '/health'
    ),
    message: rateLimitResponse
});

// OTP request is abuse-prone; key by IP + email to avoid locking everyone by shared IP.
export const otpRequestLimiter = rateLimit({
    windowMs: toWindowMs(process.env.OTP_REQUEST_WINDOW_MS, 10 * 60 * 1000),
    max: toPositiveInt(process.env.OTP_REQUEST_MAX, 5),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}:${extractEmail(req)}`,
    message: {
        error: 'Too many OTP requests. Please wait before requesting a new code.'
    }
});

export const otpVerifyLimiter = rateLimit({
    windowMs: toWindowMs(process.env.OTP_VERIFY_WINDOW_MS, 10 * 60 * 1000),
    max: toPositiveInt(process.env.OTP_VERIFY_MAX, 15),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}:${extractEmail(req)}`,
    message: {
        error: 'Too many verification attempts. Please wait and try again.'
    }
});
