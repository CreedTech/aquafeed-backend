import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Load environment variables
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aquafeed';

export const connectDatabase = async (): Promise<void> => {
    try {
        console.log('Connecting to MongoDB...');

        await mongoose.connect(MONGODB_URI);

        console.log('✓ MongoDB connected successfully');
        console.log(`  Database: ${mongoose.connection.name}`);
        console.log(`  Host: ${mongoose.connection.host}`);

        // Handle connection events
        mongoose.connection.on('error', (err) => {
            console.error('MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('MongoDB disconnected');
        });

        // Graceful shutdown
        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            console.log('MongoDB connection closed due to app termination');
            process.exit(0);
        });

    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        process.exit(1);
    }
};

export default connectDatabase;
