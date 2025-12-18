// Seed script to update ingredient prices in database
// Run with: npx ts-node src/scripts/seedPrices.ts

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Ingredient from '../models/Ingredient';

dotenv.config();

// Nigerian market prices (₦/kg) - December 2024 estimates
const INGREDIENT_PRICES: Record<string, number> = {
    // Carbohydrates (Energy sources)
    'MAIZE': 350,
    'GUINEA CORN': 380,
    'MILLET': 400,
    'WHOLE WHEAT': 420,
    'MOLASSES': 150,
    'CASSAVA MEAL': 180,
    'SORGHUM': 360,
    'INDOMIE WASTE': 200,
    'RICE BRAN': 150,
    'WHEAT OFFALS': 180,
    'WHEAT BRAN': 170,
    'WHEAT FLOUR': 450,
    'POTATO IRISH': 300,
    'SWEET POTATO': 250,
    'COCOYAM PEELED': 280,
    'COCOYAM UNPEELED': 200,
    'ACHA': 500,
    'CARROT': 350,

    // Proteins
    'FISHMEAL 65%': 1200,
    'FISHMEAL 72%': 1500,
    'SOYABEAN MEAL': 480,
    'SOYACAKE': 420,
    'FULL FAT SOYA': 520,
    'GROUNDNUT CAKE': 380,
    'COTTON SEED MEAL': 320,
    'PALM KERNEL CAKE': 200,
    'BLOOD MEAL': 600,
    'MEAT MEAL': 550,
    'FEATHER MEAL': 400,
    'POULTRY BY-PRODUCT': 450,
    'SHRIMP MEAL': 800,
    'CRAYFISH MEAL': 900,
    'CHAD FISH': 700,
    'BREWERS YEAST': 350,
    'LOCUST BEAN SEED': 450,
    'COWPEA SEED': 400,
    'CASHEW NUT': 1200,
    'COCONUT SEED': 350,
    'COCONUT SEED MEAL': 280,
    'GRASSHOPPER': 800,
    'EGG': 650,
    'SNAIL MEAL': 700,

    // Oils/Fats
    'PALM OIL': 800,
    'SOYBEAN OIL': 1000,
    'FISH OIL': 1200,
    'VEGETABLE OIL': 950,

    // Minerals
    'BONE MEAL': 250,
    'OYSTER SHELL': 150,
    'LIMESTONE': 100,
    'DICALCIUM PHOSPHATE': 450,
    'SALT': 80,
    'CALCIUM': 200,

    // Amino Acids & Additives
    'LYSINE': 1800,
    'METHIONINE': 2200,
    'FISH PREMIX': 2500,
    'VITAMIN PREMIX': 2800,
    'MINERAL PREMIX': 2000,
};

async function seedPrices() {
    try {
        await mongoose.connect(process.env.MONGODB_URI!);
        console.log('Connected to MongoDB');

        let updated = 0;
        let notFound = 0;

        for (const [name, price] of Object.entries(INGREDIENT_PRICES)) {
            const result = await Ingredient.updateOne(
                { name: { $regex: new RegExp(`^${name}$`, 'i') } },
                { $set: { defaultPrice: price } }
            );

            if (result.matchedCount > 0) {
                console.log(`✓ Updated ${name}: ₦${price}/kg`);
                updated++;
            } else {
                console.log(`✗ Not found: ${name}`);
                notFound++;
            }
        }

        // For any remaining ingredients without prices, set a default based on category
        const noPrice = await Ingredient.find({ defaultPrice: null });
        for (const ing of noPrice) {
            let defaultPrice = 300; // Default fallback
            switch (ing.category) {
                case 'PROTEIN': defaultPrice = 600; break;
                case 'CARBOHYDRATE': defaultPrice = 300; break;
                case 'FIBER': defaultPrice = 200; break;
                case 'MINERALS': defaultPrice = 300; break;
            }
            await Ingredient.updateOne({ _id: ing._id }, { $set: { defaultPrice } });
            console.log(`⚡ Auto-priced ${ing.name}: ₦${defaultPrice}/kg (${ing.category})`);
        }

        console.log(`\n✅ Done! Updated: ${updated}, Not found: ${notFound}`);
        await mongoose.disconnect();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

seedPrices();
