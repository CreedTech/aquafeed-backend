import { Request, Response } from 'express';
import User from '../../models/User';
import { generateOTP, storeOTP, verifyOTP } from '../../utils/otp.util';
import { sendOTP } from '../../services/email.service';

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

        // Generate and store OTP
        const otp = generateOTP();
        await storeOTP(email, otp);
        console.log(`[OTP] Generated for ${email}: ${otp}`);

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
            user: {
                id: user._id,
                email: user.email,
                name: user.name || 'Farmer',
                role: user.role,
                hasFullAccess: user.hasFullAccess,
                freeTrialUsed: user.freeTrialUsed,
                formulaCount: user.formulaCount,
                walletBalance: user.walletBalance,
            },
            isNewUser
        });

    } catch (error) {
        console.error('Verify OTP Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get current logged-in user
 */
export const getCurrentUser = async (req: Request, res: Response) => {
    try {
        if (!req.session.userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const user = await User.findById(req.session.userId).select('-__v');
        if (!user) {
            req.session.destroy(() => { });
            res.status(404).json({ error: 'User not found' });
            return;
        }

        res.json({
            user: {
                id: user._id,
                email: user.email,
                name: user.name || 'Farmer',
                role: user.role,
                hasFullAccess: user.hasFullAccess,
                freeTrialUsed: user.freeTrialUsed,
                formulaCount: user.formulaCount,
                walletBalance: user.walletBalance,
            }
        });
    } catch (error) {
        console.error('Get User Error:', error);
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
