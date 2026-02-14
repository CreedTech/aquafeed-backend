import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Configuration from '../models/Configuration';

dotenv.config();

const configs = [
    // Financials
    {
        key: 'formulation_fee',
        value: 10000,
        description: 'Cost to unlock a full formulation recipe in Naira',
        category: 'FINANCIAL'
    },
    {
        key: 'demo_weight_limit',
        value: 5,
        description: 'Maximum batch weight (kg) allowed in demo mode',
        category: 'FINANCIAL'
    },
    // Scientific Multipliers (Formula: [(P*m1) + (C*m2) + (F*m3)] * m4)
    {
        key: 'energy_protein_mult',
        value: 4,
        description: 'ME multiplier for Protein',
        category: 'SCIENTIFIC'
    },
    {
        key: 'energy_carb_mult',
        value: 4,
        description: 'ME multiplier for Carbohydrates',
        category: 'SCIENTIFIC'
    },
    {
        key: 'energy_fat_mult',
        value: 9,
        description: 'ME multiplier for Fats',
        category: 'SCIENTIFIC'
    },
    {
        key: 'energy_global_mult',
        value: 10,
        description: 'Global conversion factor for ME (kcal/kg)',
        category: 'SCIENTIFIC'
    },
    // Solver Preferences & Thresholds
    {
        key: 'maize_preference_multiplier',
        value: 0.9999,
        description: 'Multiplier applied to Maize price to favor it over Sorghum (lower is more favored)',
        category: 'SOLVER'
    },
    {
        key: 'min_animal_protein_percent',
        value: 10,
        description: 'Minimum required animal protein percentage in Catfish feed',
        category: 'SOLVER'
    },
    {
        key: 'blood_meal_max_ratio',
        value: 10,
        description: 'Maximum percentage of Blood Meal relative to TOTAL animal protein (e.g. 10 means 10%)',
        category: 'SOLVER'
    },
    {
        key: 'suggestion_allow_relaxations',
        value: true,
        description: 'Allow one-tap recommended relaxations for infeasible formulations',
        category: 'SOLVER'
    },
    {
        key: 'suggestion_max_relaxation_step_pct',
        value: 5,
        description: 'Maximum nutrient relaxation step (%) allowed per one-tap action',
        category: 'SOLVER'
    },
    {
        key: 'suggestion_rank_strategy',
        value: 'cost_first',
        description: 'Ranking strategy for suggested actions (cost_first/compliance_first/balanced)',
        category: 'SOLVER'
    }
];

const seedConfigs = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI!);
        console.log('Connected to MongoDB');

        for (const config of configs) {
            await Configuration.findOneAndUpdate(
                { key: config.key },
                config,
                { upsert: true, new: true }
            );
            console.log(`Seeded/Updated config: ${config.key}`);
        }

        console.log('Configuration seeding complete');
        process.exit(0);
    } catch (error) {
        console.error('Seeding error:', error);
        process.exit(1);
    }
};

seedConfigs();
