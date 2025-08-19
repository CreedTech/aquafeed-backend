import Otp from '../models/Otp';

/**
 * Generate a 6-digit numeric OTP
 */
export const generateOTP = (): string => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Store OTP in MongoDB (auto-expires in 10 mins)
 */
export const storeOTP = async (email: string, otp: string): Promise<void> => {
    // Remove any existing OTPs for this email to prevent duplicates
    await Otp.deleteMany({ email });

    // Create new OTP record
    await Otp.create({ email, otp });
};

/**
 * Verify OTP from MongoDB
 */
export const verifyOTP = async (email: string, otp: string): Promise<boolean> => {
    const record = await Otp.findOne({ email, otp });

    if (record) {
        // Valid OTP found - delete it so it can't be used again
        await Otp.deleteOne({ _id: record._id });
        return true;
    }

    return false;
};
