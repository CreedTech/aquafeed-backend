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

        // 2026 Nigerian Fish Feed Standards (AquaFeed Pro)
        const standards = [
            // Starter (Fry) - 0.3mm to 2mm pellet
            {
                name: 'Premium Starter 1.5mm',
                brand: 'AquaFeed Pro',
                pelletSize: '1.5mm',
                fishType: 'Catfish',
                stage: 'Starter',
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
            // Tilapia specific
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
