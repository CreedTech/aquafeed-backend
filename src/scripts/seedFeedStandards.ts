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

        // 2026 Nigerian Fish Feed Standards (AquaFeed Pro)
        const standards = [
            // Fry - 0.3mm to 0.8mm pellet (newly hatched)
            {
                name: 'Fry Premium 0.5mm',
                brand: 'AquaFeed Pro',
                pelletSize: '0.5mm',
                fishType: 'Catfish',
                stage: 'Fry',
                targetNutrients: {
                    protein: { min: 48, max: 55 },
                    fat: { min: 14, max: 18 },
                    fiber: { max: 3 },
                    ash: { max: 10 },
                    lysine: { min: 2.8 },
                    methionine: { min: 1.2 },
                    calcium: { min: 1.2, max: 2.2 },
                    phosphorous: { min: 1.0, max: 1.8 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            },
            // Fingerling - 1mm to 2mm pellet
            {
                name: 'Fingerling Premium 1.5mm',
                brand: 'AquaFeed Pro',
                pelletSize: '1.5mm',
                fishType: 'Catfish',
                stage: 'Fingerling',
                targetNutrients: {
                    protein: { min: 45, max: 50 },
                    fat: { min: 12, max: 16 },
                    fiber: { max: 4 },
                    ash: { max: 12 },
                    lysine: { min: 2.4 },
                    methionine: { min: 1.0 },
                    calcium: { min: 1.0, max: 2.0 },
                    phosphorous: { min: 0.8, max: 1.5 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            },
            // Grower - 3mm to 4mm pellet
            {
                name: 'Grower Premium 3mm',
                brand: 'AquaFeed Pro',
                pelletSize: '3mm',
                fishType: 'Catfish',
                stage: 'Grower',
                targetNutrients: {
                    protein: { min: 40, max: 45 },
                    fat: { min: 10, max: 14 },
                    fiber: { max: 5 },
                    ash: { max: 12 },
                    lysine: { min: 2.0 },
                    methionine: { min: 0.8 },
                    calcium: { min: 1.0, max: 1.8 },
                    phosphorous: { min: 0.8, max: 1.5 }
                },
                tolerance: 2,
                isDefault: true, // DEFAULT
                isActive: true
            },
            {
                name: 'Grower Economy 4mm',
                brand: 'AquaFeed Pro',
                pelletSize: '4mm',
                fishType: 'Catfish',
                stage: 'Grower',
                targetNutrients: {
                    protein: { min: 35, max: 40 },
                    fat: { min: 8, max: 12 },
                    fiber: { max: 6 },
                    ash: { max: 14 },
                    lysine: { min: 1.8 },
                    methionine: { min: 0.7 },
                    calcium: { min: 0.8, max: 1.6 },
                    phosphorous: { min: 0.7, max: 1.4 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            },
            // Finisher - 4.5mm to 6mm pellet
            {
                name: 'Finisher Premium 4.5mm',
                brand: 'AquaFeed Pro',
                pelletSize: '4.5mm',
                fishType: 'Catfish',
                stage: 'Finisher',
                targetNutrients: {
                    protein: { min: 35, max: 40 },
                    fat: { min: 8, max: 12 },
                    fiber: { max: 6 },
                    ash: { max: 12 },
                    lysine: { min: 1.6 },
                    methionine: { min: 0.6 },
                    calcium: { min: 0.8, max: 1.5 },
                    phosphorous: { min: 0.7, max: 1.3 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            },
            {
                name: 'Finisher Economy 6mm',
                brand: 'AquaFeed Pro',
                pelletSize: '6mm',
                fishType: 'Catfish',
                stage: 'Finisher',
                targetNutrients: {
                    protein: { min: 30, max: 35 },
                    fat: { min: 6, max: 10 },
                    fiber: { max: 8 },
                    ash: { max: 14 },
                    lysine: { min: 1.4 },
                    methionine: { min: 0.5 },
                    calcium: { min: 0.6, max: 1.4 },
                    phosphorous: { min: 0.6, max: 1.2 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            },
            // Tilapia specific - All stages
            {
                name: 'Tilapia Fry 0.5mm',
                brand: 'AquaFeed Pro',
                pelletSize: '0.5mm',
                fishType: 'Tilapia',
                stage: 'Fry',
                targetNutrients: {
                    protein: { min: 40, max: 45 },
                    fat: { min: 8, max: 12 },
                    fiber: { max: 4 },
                    ash: { max: 12 },
                    lysine: { min: 2.2 },
                    methionine: { min: 0.8 },
                    calcium: { min: 1.0, max: 1.8 },
                    phosphorous: { min: 0.8, max: 1.4 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            },
            {
                name: 'Tilapia Fingerling 1.5mm',
                brand: 'AquaFeed Pro',
                pelletSize: '1.5mm',
                fishType: 'Tilapia',
                stage: 'Fingerling',
                targetNutrients: {
                    protein: { min: 36, max: 42 },
                    fat: { min: 7, max: 11 },
                    fiber: { max: 5 },
                    ash: { max: 12 },
                    lysine: { min: 2.0 },
                    methionine: { min: 0.7 },
                    calcium: { min: 0.9, max: 1.6 },
                    phosphorous: { min: 0.7, max: 1.3 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            },
            {
                name: 'Tilapia Grower 3mm',
                brand: 'AquaFeed Pro',
                pelletSize: '3mm',
                fishType: 'Tilapia',
                stage: 'Grower',
                targetNutrients: {
                    protein: { min: 32, max: 38 },
                    fat: { min: 6, max: 10 },
                    fiber: { max: 8 },
                    ash: { max: 12 },
                    lysine: { min: 1.6 },
                    methionine: { min: 0.6 },
                    calcium: { min: 0.8, max: 1.5 },
                    phosphorous: { min: 0.6, max: 1.2 }
                },
                tolerance: 2,
                isDefault: false,
                isActive: true
            },
            {
                name: 'Tilapia Finisher 4mm',
                brand: 'AquaFeed Pro',
                pelletSize: '4mm',
                fishType: 'Tilapia',
                stage: 'Finisher',
                targetNutrients: {
                    protein: { min: 28, max: 34 },
                    fat: { min: 5, max: 9 },
                    fiber: { max: 8 },
                    ash: { max: 12 },
                    lysine: { min: 1.4 },
                    methionine: { min: 0.5 },
                    calcium: { min: 0.7, max: 1.4 },
                    phosphorous: { min: 0.5, max: 1.1 }
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
