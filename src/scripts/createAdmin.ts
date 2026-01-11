/**
 * Script to create or promote a user to admin
 * Usage: npx ts-node src/scripts/createAdmin.ts <email>
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User';

dotenv.config();

async function createAdmin() {
    const email = process.argv[2];

    if (!email) {
        console.log('Usage: npx ts-node src/scripts/createAdmin.ts <email>');
        console.log('Example: npx ts-node src/scripts/createAdmin.ts admin@example.com');
        process.exit(1);
    }

    try {
        await mongoose.connect(process.env.MONGODB_URI as string);
        console.log('Connected to MongoDB');

        // Check if user exists
        let user = await User.findOne({ email: email.toLowerCase() });

        if (user) {
            // Promote existing user to admin
            user.role = 'admin';
            user.hasFullAccess = true;
            await user.save();
            console.log(`\n✅ User ${email} promoted to admin!`);
        } else {
            // Create new admin user
            user = new User({
                email: email.toLowerCase(),
                name: 'Admin',
                role: 'admin',
                hasFullAccess: true,
                isActive: true
            });
            await user.save();
            console.log(`\n✅ New admin user created: ${email}`);
        }

        console.log('\nAdmin Details:');
        console.log(`  Email: ${user.email}`);
        console.log(`  Role: ${user.role}`);
        console.log(`  Has Full Access: ${user.hasFullAccess}`);
        console.log('\n📧 They can now login via OTP at the admin panel.');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\nDisconnected from MongoDB');
    }
}

createAdmin();
