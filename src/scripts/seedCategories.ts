import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Category from '../models/Category';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aquafeed';

async function seedCategories() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('Connected successfully!\n');

        // Default fish types
        const fishTypes = [
            { name: 'CATFISH', displayName: 'Catfish', type: 'fish_type' as const, sortOrder: 1 },
            { name: 'TILAPIA', displayName: 'Tilapia', type: 'fish_type' as const, sortOrder: 2 },
        ];

        // Default stages
        const stages = [
            { name: 'FRY', displayName: 'Fry', type: 'stage' as const, sortOrder: 1, description: 'Very young fish, 0-4 weeks' },
            { name: 'FINGERLING', displayName: 'Fingerling', type: 'stage' as const, sortOrder: 2, description: 'Juvenile fish, 1-3 months' },
            { name: 'GROWER', displayName: 'Grower', type: 'stage' as const, sortOrder: 3, description: 'Growing fish, 3-6 months' },
            { name: 'FINISHER', displayName: 'Finisher', type: 'stage' as const, sortOrder: 4, description: 'Mature fish ready for harvest' },
        ];

        console.log('Seeding fish types...');
        for (const ft of fishTypes) {
            await Category.findOneAndUpdate(
                { name: ft.name, type: ft.type },
                { $set: ft },
                { upsert: true, new: true }
            );
            console.log(`  ✓ ${ft.displayName}`);
        }

        console.log('\nSeeding stages...');
        for (const stage of stages) {
            await Category.findOneAndUpdate(
                { name: stage.name, type: stage.type },
                { $set: stage },
                { upsert: true, new: true }
            );
            console.log(`  ✓ ${stage.displayName}`);
        }

        console.log('\n============================================================');
        console.log('CATEGORIES SEEDED SUCCESSFULLY!');
        console.log('============================================================');

        const counts = await Category.aggregate([
            { $group: { _id: '$type', count: { $sum: 1 } } }
        ]);
        counts.forEach(c => console.log(`${c._id}: ${c.count}`));

    } catch (error) {
        console.error('Seed Error:', error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('\nDatabase connection closed');
    }
}

seedCategories();
