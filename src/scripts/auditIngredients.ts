import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Ingredient from '../models/Ingredient';

dotenv.config();

const checkData = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/aquafeed');
        console.log('Connected to MongoDB');

        const names = ['MAIZE', 'PALM OIL', 'SOYABEAN MEAL', 'FISHMEAL 65%', 'BONE MEAL'];
        const ingredients = await Ingredient.find({ name: { $in: names.map(n => new RegExp('^' + n + '$', 'i')) } });

        console.log('\n--- Ingredient Data Audit ---');
        ingredients.forEach(ing => {
            console.log(`\nName: ${ing.name}`);
            console.log(`Energy: ${ing.nutrients.energy} kcal/kg`);
            console.log(`Protein: ${ing.nutrients.protein}%`);
            console.log(`Calcium: ${ing.nutrients.calcium}%`);
            console.log(`Phosphorous: ${ing.nutrients.phosphorous}%`);
        });

        process.exit(0);
    } catch (error) {
        console.error('Audit error:', error);
        process.exit(1);
    }
};

checkData();
