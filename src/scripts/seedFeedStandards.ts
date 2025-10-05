import mongoose from 'mongoose';
import FeedStandard from '../models/FeedStandard';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aquafeed';

/**
 * Seed Coppens and other feed standards
 * Based on industry benchmarks for Nigerian aquaculture
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

        // Coppens Standards
        const standards = [
            {
                name: 'Coppens 2mm Starter',
                brand: 'Coppens',
                pelletSize: '2mm',
                fishType: 'Catfish',
                stage: 'Starter',
                targetNutrients: {
                    protein: { min: 45, max: 48 },
                    fat: { min: 14, max: 16 },
                    fiber: { max: 3.0 },
                    ash: { max: 10 },
                    lysine: { min: 2.5 },
                    methionine: { min: 1.2 },
                    calcium: { min: 1.0, max: 1.5 },
                    phosphorous: { min: 1.0, max: 1.5 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            },
            {
                name: 'Coppens 3mm Grower',
                brand: 'Coppens',
                pelletSize: '3mm',
                fishType: 'Catfish',
                stage: 'Grower',
                targetNutrients: {
                    protein: { min: 42, max: 45 },
                    fat: { min: 12, max: 15 },
                    fiber: { max: 3.5 },
                    ash: { max: 12 },
                    lysine: { min: 2.2 },
                    methionine: { min: 1.0 },
                    calcium: { min: 1.0, max: 1.5 },
                    phosphorous: { min: 1.0, max: 1.5 }
                },
                tolerance: 2,
                isDefault: true,  // Default standard
                isActive: true
            },
            {
                name: 'Coppens 4.5mm Finisher',
                brand: 'Coppens',
                pelletSize: '4.5mm',
                fishType: 'Catfish',
                stage: 'Finisher',
                targetNutrients: {
                    protein: { min: 38, max: 42 },
                    fat: { min: 10, max: 13 },
                    fiber: { max: 4.0 },
                    ash: { max: 12 },
                    lysine: { min: 2.0 },
                    methionine: { min: 0.9 },
                    calcium: { min: 1.0, max: 1.5 },
                    phosphorous: { min: 1.0, max: 1.5 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            },
            {
                name: 'Blue Crown 3mm',
                brand: 'Blue Crown',
                pelletSize: '3mm',
                fishType: 'Catfish',
                stage: 'Grower',
                targetNutrients: {
                    protein: { min: 40, max: 43 },
                    fat: { min: 11, max: 14 },
                    fiber: { max: 4.0 },
                    ash: { max: 13 },
                    lysine: { min: 2.0 },
                    methionine: { min: 0.9 },
                    calcium: { min: 1.0, max: 1.6 },
                    phosphorous: { min: 1.0, max: 1.6 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            },
            {
                name: 'Tilapia Starter',
                brand: 'Generic',
                pelletSize: '2mm',
                fishType: 'Tilapia',
                stage: 'Starter',
                targetNutrients: {
                    protein: { min: 35, max: 38 },
                    fat: { min: 8, max: 11 },
                    fiber: { max: 5.0 },
                    ash: { max: 12 },
                    lysine: { min: 1.8 },
                    methionine: { min: 0.8 },
                    calcium: { min: 1.0, max: 2.0 },
                    phosphorous: { min: 0.8, max: 1.5 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            },
            {
                name: 'Tilapia Grower',
                brand: 'Generic',
                pelletSize: '3mm',
                fishType: 'Tilapia',
                stage: 'Grower',
                targetNutrients: {
                    protein: { min: 30, max: 35 },
                    fat: { min: 6, max: 10 },
                    fiber: { max: 6.0 },
                    ash: { max: 13 },
                    lysine: { min: 1.5 },
                    methionine: { min: 0.7 },
                    calcium: { min: 1.0, max: 2.0 },
                    phosphorous: { min: 0.8, max: 1.5 }
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
            console.log(`  • ${std.name} (${std.brand} - ${std.fishType})${defaultTag}`);
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
