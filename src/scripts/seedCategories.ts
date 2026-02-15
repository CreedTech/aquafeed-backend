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

        // Feed domains in scope
        const feedTypes = [
            { name: 'FISH', displayName: 'Fish', type: 'feed_type' as const, sortOrder: 1 },
            { name: 'POULTRY', displayName: 'Poultry', type: 'feed_type' as const, sortOrder: 2 },
        ];

        // Default fish subtypes
        const fishSubtypes = [
            { name: 'CATFISH', displayName: 'Catfish', type: 'fish_type' as const, sortOrder: 1 },
            { name: 'TILAPIA', displayName: 'Tilapia', type: 'fish_type' as const, sortOrder: 2 },
        ];

        // Default stages
        const stages = [
            { name: 'FRY', displayName: 'Fry', type: 'stage' as const, sortOrder: 1, description: 'Very young fish' },
            { name: 'FINGERLING', displayName: 'Fingerling', type: 'stage' as const, sortOrder: 2, description: 'Juvenile fish' },
            { name: 'GROWER', displayName: 'Grower', type: 'stage' as const, sortOrder: 3, description: 'Growing phase' },
            { name: 'FINISHER', displayName: 'Finisher', type: 'stage' as const, sortOrder: 4, description: 'Harvest ready' },
            { name: 'STARTER', displayName: 'Starter', type: 'stage' as const, sortOrder: 5, description: 'Poultry early stage' },
            { name: 'BROILER_FINISHER', displayName: 'Broiler Finisher', type: 'stage' as const, sortOrder: 6, description: 'Poultry finishing stage' },
            { name: 'LAYER_PROD', displayName: 'Layer Production', type: 'stage' as const, sortOrder: 7, description: 'Poultry egg production' },
        ];

        // Default poultry subtypes
        const poultrySubtypes = [
            { name: 'BROILER', displayName: 'Broiler', type: 'poultry_type' as const, sortOrder: 1 },
            { name: 'LAYER', displayName: 'Layer', type: 'poultry_type' as const, sortOrder: 2 },
        ];

        console.log('Seeding feed types...');
        for (const ft of feedTypes) {
            await Category.findOneAndUpdate(
                { name: ft.name, type: ft.type },
                { $set: ft },
                { upsert: true, new: true }
            );
            console.log(`  ✓ ${ft.displayName}`);
        }

        console.log('\nSeeding fish subtypes...');
        for (const fishSubtype of fishSubtypes) {
            await Category.findOneAndUpdate(
                { name: fishSubtype.name, type: fishSubtype.type },
                { $set: fishSubtype },
                { upsert: true, new: true }
            );
            console.log(`  ✓ ${fishSubtype.displayName}`);
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

        console.log('\nSeeding poultry subtypes...');
        for (const cat of poultrySubtypes) {
            await Category.findOneAndUpdate(
                { name: cat.name, type: cat.type },
                { $set: cat },
                { upsert: true, new: true }
            );
            console.log(`  ✓ ${cat.displayName}`);
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
