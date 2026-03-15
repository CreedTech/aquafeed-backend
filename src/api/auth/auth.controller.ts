import { Request, Response } from 'express';
import User from '../../models/User';
import { generateOTP, storeOTP, verifyOTP } from '../../utils/otp.util';
import { sendOTP } from '../../services/email.service';
import { isDatabaseReady, isTransientMongoError } from '../../config/database';

const resolveAuthenticatedUserId = (req: Request): string | null => (
    req.userId || req.session?.userId || null
);

const toUserPayload = (user: {
    _id: unknown;
    email: string;
    name?: string;
    role: string;
    hasFullAccess: boolean;
    freeTrialUsed: boolean;
    formulaCount: number;
    walletBalance: number;
}) => ({
    id: user._id,
    email: user.email,
    name: user.name || 'Farmer',
    role: user.role,
    hasFullAccess: user.hasFullAccess,
    freeTrialUsed: user.freeTrialUsed,
    formulaCount: user.formulaCount,
    walletBalance: user.walletBalance,
});

/**
 * Request OTP for login (Passwordless)
 * Uses Gmail SMTP to send OTP
 */
export const requestOtp = async (req: Request, res: Response) => {
    try {
        const { email } = req.body;

        if (!email) {
            res.status(400).json({ error: 'Email is required' });
            return;
        }

        if (!isDatabaseReady()) {
            res.status(503).json({
                error: 'Service temporarily unavailable',
                message: 'Database connection is unstable. Please retry in a few seconds.'
            });
            return;
        }

        // Generate and store OTP
        const otp = generateOTP();
        await storeOTP(email, otp);

        // Send OTP via email
        try {
            await sendOTP(email, otp);
            res.json({ message: 'OTP sent successfully to your email' });
        } catch (emailError) {
            console.error('Email sending failed:', emailError);
            res.status(500).json({ error: 'Failed to send email. Please try again.' });
        }

    } catch (error) {
        console.error('Request OTP Error:', error);
        if (isTransientMongoError(error)) {
            res.status(503).json({
                error: 'Service temporarily unavailable',
                message: 'Database connection was interrupted. Please retry in a few seconds.'
            });
            return;
        }
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Verify OTP and create session (cookie-based)
 */
export const verifyOtp = async (req: Request, res: Response) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            res.status(400).json({ error: 'Email and OTP are required' });
            return;
        }

        if (!isDatabaseReady()) {
            res.status(503).json({
                error: 'Service temporarily unavailable',
                message: 'Database connection is unstable. Please retry in a few seconds.'
            });
            return;
        }

        // Verify OTP
        const isValid = await verifyOTP(email, otp);
        if (!isValid) {
            res.status(401).json({ error: 'Invalid or expired OTP' });
            return;
        }

        // Find or Create User
        let user = await User.findOne({ email });
        let isNewUser = false;

        if (!user) {
            isNewUser = true;
            user = await User.create({
                email,
                role: 'farmer',
                hasFullAccess: false,
                freeTrialUsed: false,
                formulaCount: 0,
                walletBalance: 0,
                isActive: true
            });
            console.log(`New user registered: ${email}`);
        }

        // Create Session (cookie-based auth)
        req.session.userId = user._id.toString();
        req.session.isAdmin = user.role === 'admin';

        res.json({
            message: 'Login successful',
            user: toUserPayload(user),
            isNewUser
        });

    } catch (error) {
        console.error('Verify OTP Error:', error);
        if (isTransientMongoError(error)) {
            res.status(503).json({
                error: 'Service temporarily unavailable',
                message: 'Database connection was interrupted. Please retry in a few seconds.'
            });
            return;
        }
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get current logged-in user
 */
export const getCurrentUser = async (req: Request, res: Response) => {
    try {
        const userId = resolveAuthenticatedUserId(req);
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const user = await User.findById(userId).select('-__v');
        if (!user) {
            req.session.destroy(() => { });
            res.status(404).json({ error: 'User not found' });
            return;
        }

        res.json({
            user: toUserPayload(user)
        });
    } catch (error) {
        console.error('Get User Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Update current logged-in user profile
 */
export const updateCurrentUser = async (req: Request, res: Response) => {
    try {
        const userId = resolveAuthenticatedUserId(req);
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const setUpdates: Record<string, unknown> = {};
        const unsetUpdates: Record<string, string> = {};

        if (req.body?.name !== undefined) {
            const name = String(req.body.name || '').trim();
            if (!name) {
                res.status(400).json({ error: 'Name cannot be empty' });
                return;
            }
            if (name.length > 80) {
                res.status(400).json({ error: 'Name is too long (max 80 characters)' });
                return;
            }
            setUpdates.name = name;
        }

        if (req.body?.phone !== undefined) {
            const phone = String(req.body.phone || '').trim();
            if (!phone) {
                unsetUpdates.phone = '';
            } else {
                const phoneRegex = /^\+?[\d\s-()]+$/;
                if (!phoneRegex.test(phone)) {
                    res.status(400).json({ error: 'Please enter a valid phone number' });
                    return;
                }
                setUpdates.phone = phone;
            }
        }

        if (Object.keys(setUpdates).length === 0 && Object.keys(unsetUpdates).length === 0) {
            res.status(400).json({ error: 'No valid fields to update' });
            return;
        }

        const user = await User.findByIdAndUpdate(
            userId,
            {
                ...(Object.keys(setUpdates).length > 0 ? { $set: setUpdates } : {}),
                ...(Object.keys(unsetUpdates).length > 0 ? { $unset: unsetUpdates } : {})
            },
            { new: true, runValidators: true }
        );

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        res.json({
            message: 'Profile updated successfully',
            user: toUserPayload(user)
        });
    } catch (error) {
        console.error('Update User Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Logout - destroy session
 */
export const logout = (req: Request, res: Response) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout Error:', err);
            res.status(500).json({ error: 'Could not log out' });
            return;
        }
        res.clearCookie('connect.sid');
        res.json({ message: 'Logged out successfully' });
    });
};
