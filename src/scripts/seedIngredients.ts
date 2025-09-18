import mongoose from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import Ingredient from '../models/Ingredient';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aquafeed';

interface IngredientData {
    name: string;
    category: string;
    defaultPrice: number | null;
    nutrients: {
        protein: number;
        fat: number;
        fiber: number;
        ash: number;
        lysine: number;
        methionine: number;
        calcium: number;
        phosphorous: number;
    };
}

async function seedIngredients() {
    try {
        // Connect to MongoDB
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB successfully!\n');

        // Read the ingredients data file
        const dataPath = path.join(__dirname, '../../../ingredients_data.json');
        console.log(`Reading ingredients data from: ${dataPath}`);

        const rawData = fs.readFileSync(dataPath, 'utf-8');
        const ingredientsData: IngredientData[] = JSON.parse(rawData);
        console.log(`Found ${ingredientsData.length} ingredients to import\n`);

        // Clear existing ingredients (optional - remove in production if you want to preserve data)
        console.log('Clearing existing ingredients...');
        await Ingredient.deleteMany({});
        console.log('Cleared existing ingredients\n');

        // Add constraints based on ingredient characteristics
        const ingredientsWithConstraints = ingredientsData.map(ing => {
            const ingredient: any = {
                name: ing.name,
                category: ing.category,
                defaultPrice: ing.defaultPrice,
                nutrients: ing.nutrients,
                constraints: {},
                alternatives: [],
                isActive: true
            };

            // Add special constraints based on ingredient type
            if (ing.name === 'MAIZE') {
                ingredient.constraints.max_inclusion = 60; // Max 60% maize for digestibility
            }

            if (ing.name.includes('BLOOD MEAL')) {
                ingredient.constraints.max_inclusion = 5; // Blood meal poorly digested
            }

            if (ing.name.includes('INDOMIE WASTE')) {
                ingredient.constraints.max_inclusion = 10; // Used as binder
            }

            // Set bag weights for common ingredients
            if (['MAIZE', 'GUINEA CORN', 'WHEAT', 'SORGHUM'].some(name => ing.name.includes(name))) {
                ingredient.bagWeight = 50; // 50kg bags for grains
            }

            if (ing.name.includes('FISHMEAL') || ing.name.includes('FISH MEAL')) {
                ingredient.bagWeight = 50; // 50kg bags
            }

            if (ing.name.includes('SOYA') || ing.name.includes('GROUNDNUT CAKE')) {
                ingredient.bagWeight = 50; // 50kg bags
            }

            // Palm Oil - specific gravity for volume to weight conversion
            if (ing.name.includes('PALM OIL')) {
                ingredient.specificGravity = 0.91; // 1 liter = 0.91 kg
            }

            // Vitamin C - auto-calculated at 400mg/kg of feed
            if (ing.name.includes('VITAMIN C') || ing.name.includes('VIAMIN C')) {
                ingredient.isAutoCalculated = true;
                ingredient.autoCalcRatio = 0.0004; // 400mg/kg = 0.4g/kg = 0.0004
            }

            return ingredient;
        });

        // Insert all ingredients
        console.log('Inserting ingredients into database...');
        const insertedIngredients = await Ingredient.insertMany(ingredientsWithConstraints);
        console.log(`✓ Successfully inserted ${insertedIngredients.length} ingredients\n`);

        // Create alternative relationships
        console.log('Setting up ingredient alternatives...');

        // Maize alternatives
        const maize = await Ingredient.findOne({ name: 'MAIZE' });
        const sorghum = await Ingredient.findOne({ name: 'SORGHUM' });
        const indomieWaste = await Ingredient.findOne({ name: 'INDOMIE WASTE' });
        const guineaCorn = await Ingredient.findOne({ name: 'GUINEA CORN' });

        if (maize && sorghum && indomieWaste && guineaCorn) {
            maize.alternatives = [sorghum._id, indomieWaste._id, guineaCorn._id];
            await maize.save();
            console.log('  ✓ Set alternatives for MAIZE');
        }

        // Soya alternatives
        const fullFatSoya = await Ingredient.findOne({ name: 'FULL FAT SOYA' });
        const soyaCake = await Ingredient.findOne({ name: 'SOYACAKE' });
        const soyaBeanMeal = await Ingredient.findOne({ name: 'SOYABEAN MEAL' });
        const groundnutCake = await Ingredient.findOne({ name: 'GROUNDNUT CAKE' });

        if (fullFatSoya && soyaCake && soyaBeanMeal && groundnutCake) {
            fullFatSoya.alternatives = [soyaCake._id, soyaBeanMeal._id, groundnutCake._id];
            await fullFatSoya.save();

            soyaCake.alternatives = [fullFatSoya._id, soyaBeanMeal._id];
            await soyaCake.save();

            console.log('  ✓ Set alternatives for SOYA products');
        }

        // Fish meal alternatives
        const fishMeal72 = await Ingredient.findOne({ name: 'FISHMEAL 72%' });
        const fishMeal65 = await Ingredient.findOne({ name: 'FISHMEAL 65%' });

        if (fishMeal72 && fishMeal65) {
            fishMeal72.alternatives = [fishMeal65._id];
            await fishMeal72.save();

            fishMeal65.alternatives = [fishMeal72._id];
            await fishMeal65.save();

            console.log('  ✓ Set alternatives for FISHMEAL');
        }

        console.log('\n' + '='.repeat(60));
        console.log('SEED COMPLETED SUCCESSFULLY!');
        console.log('='.repeat(60));
        console.log(`Total ingredients in database: ${await Ingredient.countDocuments()}`);

        // Show summary by category
        console.log('\nIngredients by category:');
        const categories = await Ingredient.aggregate([
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]);

        categories.forEach(cat => {
            console.log(`  ${cat._id}: ${cat.count}`);
        });

    } catch (error) {
        console.error('Error seeding ingredients:', error);
        process.exit(1);
    } finally {
        // Close MongoDB connection
        await mongoose.connection.close();
        console.log('\nDatabase connection closed');
        process.exit(0);
    }
}

// Run the seed function
seedIngredients();
