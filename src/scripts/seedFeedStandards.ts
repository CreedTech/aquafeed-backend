import mongoose from 'mongoose';
import FeedStandard from '../models/FeedStandard';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aquafeed';

/**
 * Seed AquaFeed Pro standards for Nigerian aquaculture
 * Stages: Fry, Fingerling, Grower, Finisher
 */
async function seedFeedStandards() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('Connected successfully!\n');

        // Clear existing standards
        console.log('Clearing existing feed standards...');
        await FeedStandard.deleteMany({});
        console.log('Cleared existing standards\n');

        // 2026 Feed Standards (AquaFeed Pro)
        const standards = [
            // --- CATFISH ---
            {
                name: 'Catfish Fry 0.5mm',
                brand: 'AquaFeed Pro',
                pelletSize: '0.5mm',
                feedCategory: 'Catfish',
                fishType: 'Catfish',
                stage: 'Fry',
                targetNutrients: {
                    energy: { min: 3200, max: 3600 },
                    protein: { min: 48, max: 55 },
                    fat: { min: 14, max: 18 },
                    fiber: { min: 0, max: 3 },
                    ash: { min: 0, max: 10 },
                    lysine: { min: 2.8, max: 5 },
                    methionine: { min: 1.2, max: 3 },
                    calcium: { min: 1.2, max: 2.2 },
                    phosphorous: { min: 1.0, max: 1.8 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            },
            {
                name: 'Catfish Grower 3mm',
                brand: 'AquaFeed Pro',
                pelletSize: '3mm',
                feedCategory: 'Catfish',
                fishType: 'Catfish',
                stage: 'Grower',
                targetNutrients: {
                    energy: { min: 3000, max: 3400 },
                    protein: { min: 40, max: 45 },
                    fat: { min: 10, max: 14 },
                    fiber: { min: 0, max: 5 },
                    ash: { min: 0, max: 12 },
                    lysine: { min: 2.0, max: 4 },
                    methionine: { min: 0.8, max: 2 },
                    calcium: { min: 1.0, max: 1.8 },
                    phosphorous: { min: 0.8, max: 1.5 }
                },
                tolerance: 2,
                isDefault: true,
                isActive: true
            },

            // --- POULTRY: BROILER ---
            {
                name: 'Broiler Starter',
                brand: 'PoultryPro',
                pelletSize: 'Mash/Crumble',
                feedCategory: 'Poultry',
                poultryType: 'Broiler',
                stage: 'Starter',
                targetNutrients: {
                    protein: { min: 22, max: 24 },
                    fat: { min: 4, max: 8 },
                    energy: { min: 2950, max: 3050 }, // kcal/kg ME
                    fiber: { min: 0, max: 4 },
                    lysine: { min: 1.2, max: 1.5 },
                    methionine: { min: 0.5, max: 0.8 },
                    calcium: { min: 0.9, max: 1.1 },
                    phosphorous: { min: 0.45, max: 0.6 }
                },
                tolerance: 2,
                isDefault: true,
                isActive: true
            },
            {
                name: 'Broiler Grower',
                brand: 'PoultryPro',
                pelletSize: 'Pellet',
                feedCategory: 'Poultry',
                poultryType: 'Broiler',
                stage: 'Grower',
                targetNutrients: {
                    protein: { min: 19, max: 21 },
                    fat: { min: 5, max: 9 },
                    energy: { min: 3050, max: 3150 },
                    fiber: { min: 0, max: 5 },
                    lysine: { min: 1.0, max: 1.3 },
                    methionine: { min: 0.45, max: 0.7 },
                    calcium: { min: 0.85, max: 1.05 },
                    phosphorous: { min: 0.4, max: 0.55 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            },
            {
                name: 'Broiler Finisher',
                brand: 'PoultryPro',
                pelletSize: 'Pellet',
                feedCategory: 'Poultry',
                poultryType: 'Broiler',
                stage: 'Finisher',
                targetNutrients: {
                    protein: { min: 17.5, max: 19 },
                    fat: { min: 6, max: 10 },
                    energy: { min: 3150, max: 3250 },
                    fiber: { min: 0, max: 5 },
                    lysine: { min: 0.9, max: 1.2 },
                    methionine: { min: 0.4, max: 0.65 },
                    calcium: { min: 0.8, max: 1.0 },
                    phosphorous: { min: 0.35, max: 0.5 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            },

            // --- POULTRY: LAYER ---
            {
                name: 'Layer Chick Starter',
                brand: 'PoultryPro',
                pelletSize: 'Mash',
                feedCategory: 'Poultry',
                poultryType: 'Layer',
                stage: 'Starter',
                targetNutrients: {
                    protein: { min: 19, max: 21 },
                    fat: { min: 3, max: 6 },
                    energy: { min: 2800, max: 2900 },
                    fiber: { min: 0, max: 5 },
                    lysine: { min: 1.0, max: 1.3 },
                    calcium: { min: 0.9, max: 1.2 },
                    phosphorous: { min: 0.4, max: 0.6 }
                },
                tolerance: 2,
                isDefault: true,
                isActive: true
            },
            {
                name: 'Layer Phase 1 (Peak Production)',
                brand: 'PoultryPro',
                pelletSize: 'Mash',
                feedCategory: 'Poultry',
                poultryType: 'Layer',
                stage: 'Grower', // Categorized as grower stage in simple model
                targetNutrients: {
                    protein: { min: 16.5, max: 18 },
                    fat: { min: 3, max: 7 },
                    energy: { min: 2750, max: 2850 },
                    fiber: { min: 0, max: 6 },
                    lysine: { min: 0.8, max: 1.0 },
                    calcium: { min: 3.5, max: 4.2 }, // High calcium for eggs
                    phosphorous: { min: 0.35, max: 0.5 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            }
        ];

        console.log(`Inserting ${standards.length} feed standards...\n`);
        const insertedStandards = await FeedStandard.insertMany(standards);

        console.log('✓ Successfully inserted feed standards:\n');
        insertedStandards.forEach(std => {
            const defaultTag = std.isDefault ? ' [DEFAULT]' : '';
            const typeInfo = std.feedCategory === 'Catfish' ? std.fishType : std.poultryType;
            console.log(`  • ${std.name} (${std.brand} - ${typeInfo})${defaultTag}`);
        });

        console.log('\n' + '='.repeat(60));
        console.log('FEED STANDARDS SEEDED SUCCESSFULLY!');
        console.log('='.repeat(60));
        console.log(`Total standards in database: ${await FeedStandard.countDocuments()}`);

    } catch (error) {
        console.error('Error seeding feed standards:', error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('\nDatabase connection closed');
        process.exit(0);
    }
}

// Run the seed function
seedFeedStandards();
