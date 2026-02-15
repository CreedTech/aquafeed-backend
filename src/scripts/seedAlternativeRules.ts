import mongoose from 'mongoose';
import dotenv from 'dotenv';
import AlternativeRule from '../models/AlternativeRule';
import Ingredient from '../models/Ingredient';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aquafeed';

type SeedRule = {
    originalName: string;
    alternativeName: string;
    feedType: 'fish' | 'poultry' | 'both';
    maxBlendPercent: number;
    notes: string;
};

const seedRules: SeedRule[] = [
    {
        originalName: 'MAIZE',
        alternativeName: 'SORGHUM',
        feedType: 'both',
        maxBlendPercent: 100,
        notes: 'Direct cereal substitution where maize cost spikes.'
    },
    {
        originalName: 'MAIZE',
        alternativeName: 'GUINEA CORN',
        feedType: 'both',
        maxBlendPercent: 100,
        notes: 'Alternative cereal option for cost balancing.'
    },
    {
        originalName: 'MAIZE',
        alternativeName: 'WHOLE WHEAT',
        feedType: 'both',
        maxBlendPercent: 60,
        notes: 'Use partial replacement to control fiber and cost.'
    },
    {
        originalName: 'SORGHUM',
        alternativeName: 'MAIZE',
        feedType: 'both',
        maxBlendPercent: 100,
        notes: 'Reverse mapping for flexible cereal pricing.'
    },
    {
        originalName: 'SOYABEAN MEAL',
        alternativeName: 'FULL FAT SOYA',
        feedType: 'both',
        maxBlendPercent: 75,
        notes: 'High-protein swap with higher energy contribution.'
    },
    {
        originalName: 'SOYABEAN MEAL',
        alternativeName: 'SOYACAKE',
        feedType: 'both',
        maxBlendPercent: 75,
        notes: 'Protein source swap for local availability.'
    },
    {
        originalName: 'SOYABEAN MEAL',
        alternativeName: 'GROUNDNUT CAKE',
        feedType: 'both',
        maxBlendPercent: 60,
        notes: 'Cost-saving protein alternative with controlled inclusion.'
    },
    {
        originalName: 'FULL FAT SOYA',
        alternativeName: 'SOYABEAN MEAL',
        feedType: 'both',
        maxBlendPercent: 100,
        notes: 'Reverse mapping to stabilize formulation feasibility.'
    },
    {
        originalName: 'FISHMEAL 72%',
        alternativeName: 'FISHMEAL 65%',
        feedType: 'both',
        maxBlendPercent: 100,
        notes: 'Primary fishmeal grade substitution.'
    },
    {
        originalName: 'FISHMEAL 65%',
        alternativeName: 'FISHMEAL 72%',
        feedType: 'both',
        maxBlendPercent: 100,
        notes: 'Reverse fishmeal grade substitution.'
    },
    {
        originalName: 'FISHMEAL 72%',
        alternativeName: 'MEAT MEAL',
        feedType: 'fish',
        maxBlendPercent: 40,
        notes: 'Partial protein replacement for fish formulations only.'
    },
    {
        originalName: 'FISHMEAL 65%',
        alternativeName: 'MEAT MEAL',
        feedType: 'fish',
        maxBlendPercent: 50,
        notes: 'Cost reduction option in fish feed when fishmeal is expensive.'
    },
    {
        originalName: 'WHEAT OFFALS',
        alternativeName: 'RICE BRAN',
        feedType: 'both',
        maxBlendPercent: 100,
        notes: 'Bran/offal swap for availability-driven formulation.'
    },
    {
        originalName: 'WHEAT OFFALS',
        alternativeName: 'MAIZE OFFALS',
        feedType: 'both',
        maxBlendPercent: 100,
        notes: 'By-product alternative for fiber-energy balancing.'
    },
    {
        originalName: 'RICE BRAN',
        alternativeName: 'WHEAT OFFALS',
        feedType: 'both',
        maxBlendPercent: 100,
        notes: 'Reverse bran/offal substitution.'
    },
    {
        originalName: 'BONE MEAL',
        alternativeName: 'DICALCIUM PHOSPHATE',
        feedType: 'both',
        maxBlendPercent: 60,
        notes: 'Mineral source substitution with controlled inclusion.'
    },
    {
        originalName: 'LIMESTONE',
        alternativeName: 'OYSTER SHELL',
        feedType: 'poultry',
        maxBlendPercent: 100,
        notes: 'Calcium source swap for layer diets.'
    },
    {
        originalName: 'OYSTER SHELL',
        alternativeName: 'LIMESTONE',
        feedType: 'poultry',
        maxBlendPercent: 100,
        notes: 'Reverse calcium source substitution for poultry.'
    }
];

async function seedAlternativeRules() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('Connected successfully!\n');

        const ingredientNames = Array.from(new Set(
            seedRules.flatMap((rule) => [rule.originalName, rule.alternativeName])
        ));
        const ingredients = await Ingredient.find({
            name: { $in: ingredientNames }
        }).select('_id name');

        const ingredientByName = new Map<string, { _id: mongoose.Types.ObjectId; name: string }>();
        ingredients.forEach((ingredient) => {
            ingredientByName.set(ingredient.name, {
                _id: ingredient._id as mongoose.Types.ObjectId,
                name: ingredient.name
            });
        });

        let seededCount = 0;
        let skippedMissingCount = 0;
        let skippedSelfCount = 0;

        for (const rule of seedRules) {
            const original = ingredientByName.get(rule.originalName);
            const alternative = ingredientByName.get(rule.alternativeName);

            if (!original || !alternative) {
                skippedMissingCount += 1;
                console.log(
                    `  - Skipped (missing ingredient): ${rule.originalName} -> ${rule.alternativeName}`
                );
                continue;
            }

            if (original._id.equals(alternative._id)) {
                skippedSelfCount += 1;
                console.log(
                    `  - Skipped (same ingredient): ${rule.originalName} -> ${rule.alternativeName}`
                );
                continue;
            }

            await AlternativeRule.findOneAndUpdate(
                {
                    originalIngredientId: original._id,
                    alternativeIngredientId: alternative._id,
                    feedType: rule.feedType
                },
                {
                    $set: {
                        maxBlendPercent: rule.maxBlendPercent,
                        notes: rule.notes,
                        isActive: true
                    }
                },
                {
                    upsert: true,
                    new: true,
                    setDefaultsOnInsert: true
                }
            );

            // Keep Ingredient.alternatives in sync for solver AUTO substitutions.
            await Ingredient.findByIdAndUpdate(original._id, {
                $addToSet: { alternatives: alternative._id }
            });

            seededCount += 1;
            console.log(
                `  ✓ ${rule.originalName} -> ${rule.alternativeName} (${rule.feedType}, max ${rule.maxBlendPercent}%)`
            );
        }

        console.log('\n' + '='.repeat(64));
        console.log('ALTERNATIVE RULE SEED COMPLETED');
        console.log('='.repeat(64));
        console.log(`Seeded/updated rules: ${seededCount}`);
        console.log(`Skipped (missing ingredients): ${skippedMissingCount}`);
        console.log(`Skipped (same ingredient): ${skippedSelfCount}`);
        console.log(`Total rules in DB: ${await AlternativeRule.countDocuments()}`);
    } catch (error) {
        console.error('Error seeding alternative rules:', error);
        process.exitCode = 1;
    } finally {
        await mongoose.connection.close();
        console.log('Database connection closed');
    }
}

seedAlternativeRules();
