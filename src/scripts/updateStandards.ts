// Update feed standards to 2026 Nigerian aquafeed industry standards
// Run with: npx ts-node src/scripts/updateStandards.ts

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import FeedStandard from '../models/FeedStandard';

dotenv.config();

// 2026 Nigerian Fish Feed Standards (updated from industry sources)
const STANDARDS_2026 = [
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
        tolerance: 8,
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
        tolerance: 8,
        isDefault: true,
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
        tolerance: 10,
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
        tolerance: 10,
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
        tolerance: 12,
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
        tolerance: 10,
        isDefault: false,
        isActive: true
    }
];

async function updateStandards() {
    try {
        await mongoose.connect(process.env.MONGODB_URI!);
        console.log('Connected to MongoDB');

        // Mark old Coppens/Blue Crown standards as inactive
        const deactivated = await FeedStandard.updateMany(
            { brand: { $in: ['Coppens', 'Blue Crown'] } },
            { $set: { isActive: false } }
        );
        console.log(`Deactivated ${deactivated.modifiedCount} old standards`);

        // Insert new standards
        for (const std of STANDARDS_2026) {
            const existing = await FeedStandard.findOne({ name: std.name });
            if (existing) {
                await FeedStandard.updateOne({ _id: existing._id }, std);
                console.log(`✓ Updated: ${std.name}`);
            } else {
                await FeedStandard.create(std);
                console.log(`+ Created: ${std.name}`);
            }
        }

        console.log('\n✅ Standards updated to 2026 industry specifications');
        await mongoose.disconnect();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

updateStandards();
