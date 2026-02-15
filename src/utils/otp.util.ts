import Otp from '../models/Otp';
import crypto from 'crypto';

/**
 * Generate a 6-digit numeric OTP
 */
export const generateOTP = (): string => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

const hashOtp = (otp: string): string => {
    const pepper = process.env.OTP_PEPPER || process.env.SESSION_SECRET || 'change-me';
    return crypto
        .createHash('sha256')
        .update(`${otp}:${pepper}`)
        .digest('hex');
};

/**
 * Store OTP in MongoDB (auto-expires in 10 mins)
 */
export const storeOTP = async (email: string, otp: string): Promise<void> => {
    // Remove any existing OTPs for this email to prevent duplicates
    await Otp.deleteMany({ email });

    // Create new OTP record
    await Otp.create({ email, otp: hashOtp(otp) });
};

/**
 * Verify OTP from MongoDB
 */
export const verifyOTP = async (email: string, otp: string): Promise<boolean> => {
    // Accept both hashed and legacy plaintext OTP values for backward compatibility.
    const hashed = hashOtp(otp);
    const record = await Otp.findOne({
        email,
        otp: { $in: [hashed, otp] }
    });

    if (record) {
        // Valid OTP found - delete it so it can't be used again
        await Otp.deleteOne({ _id: record._id });
        return true;
    }

    return false;
};
