import mongoose, { Schema, Document } from 'mongoose';

export interface IOtp extends Document {
    email: string;
    otp: string;
    createdAt: Date;
}

const OtpSchema: Schema = new Schema({
    email: {
        type: String,
        required: true,
        index: true // Add index for faster queries
    },
    otp: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 600 // Documents expire after 600 seconds (10 minutes)
    }
});

export default mongoose.model<IOtp>('Otp', OtpSchema);
