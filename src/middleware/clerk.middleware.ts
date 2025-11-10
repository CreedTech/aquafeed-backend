import { Request, Response, NextFunction } from 'express';
import { verifyToken, createClerkClient } from '@clerk/backend';
import User from '../models/User';

// Initialize Clerk client for user operations
const clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY
});

// Extend Express Request to include our user ID
declare global {
    namespace Express {
        interface Request {
            userId?: string;
            clerkUserId?: string;
        }
    }
}

/**
 * Clerk JWT Verification Middleware
 * Verifies the Clerk JWT token and syncs user with our database
 * Also supports session-based auth (OTP login)
 */
export const clerkAuth = async (req: Request, _res: Response, next: NextFunction) => {
    try {
        // First, check for session-based auth (OTP login)
        if (req.session?.userId) {
            req.userId = req.session.userId;
            return next();
        }

        // Then check for Authorization header (Clerk JWT)
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            // No token - continue without auth (for public routes)
            return next();
        }

        const token = authHeader.substring(7);

        // Verify the session token with Clerk
        const payload = await verifyToken(token, {
            secretKey: process.env.CLERK_SECRET_KEY!,
        });

        const clerkUserId = payload.sub;
        if (!clerkUserId) {
            return next(); // Invalid token, continue without auth
        }

        req.clerkUserId = clerkUserId;

        // Get user email from Clerk
        const clerkUser = await clerk.users.getUser(clerkUserId);
        const email = clerkUser.emailAddresses[0]?.emailAddress;

        if (!email) {
            return next();
        }

        // Find or create user in our database
        let user = await User.findOne({ email });

        if (!user) {
            // Create new user from Clerk data
            user = new User({
                email,
                name: clerkUser.firstName
                    ? `${clerkUser.firstName} ${clerkUser.lastName || ''}`
                    : 'Farmer',
                role: 'farmer',
                hasFullAccess: false,
                freeTrialUsed: false,
                formulaCount: 0,
                walletBalance: 0,
            });
            await user.save();
        }

        // Attach our user ID to request
        req.userId = user._id.toString();

        next();
    } catch (error) {
        console.error('Clerk auth error:', error);
        // Don't block request on auth errors, just continue without auth
        next();
    }
};

/**
 * Require authenticated user
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Please sign in to continue'
        });
    }
    next();
};

/**
 * Require admin access
 */
export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await User.findById(req.userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    next();
};

/**
 * Optional auth - doesn't require login but attaches user if present
 */
export const optionalAuth = clerkAuth;
