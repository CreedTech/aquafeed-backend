import mongoose from 'mongoose';
import dotenv from 'dotenv';
import FeedTemplate from '../models/FeedTemplate';

dotenv.config();

const templates = [
    {
        name: 'Basic Catfish Grower',
        description: 'Standard local ingredients for optimized growth',
        feedCategory: 'Catfish',
        ingredientNames: [
            'FISHMEAL 65%',
            'SOYABEAN MEAL',
            'MAIZE',
            'RICE BRAN',
            'GROUNDNUT CAKE',
            'PALM OIL',
            'BONE MEAL',
            'SALT'
        ]
    },
    {
        name: 'High-Protein Performance',
        description: 'Optimized for faster growth and better FCR',
        feedCategory: 'Catfish',
        ingredientNames: [
            'FISHMEAL 72%',
            'FULL FAT SOYA',
            'MAIZE',
            'WHEAT OFFALS',
            'BLOOD MEAL',
            'PALM OIL',
            'DICALCIUM PHOSPHATE',
            'FISH PREMIX'
        ]
    },
    {
        name: 'Fingerling Feed',
        description: 'High-nutrient starter feed for young fish',
        feedCategory: 'Catfish',
        ingredientNames: [
            'FISHMEAL 65%',
            'SOYACAKE',
            'MAIZE',
            'RICE BRAN',
            'GROUNDNUT CAKE',
            'PALM OIL',
            'BONE MEAL',
            'LYSINE'
        ]
    },
    {
        name: 'Broiler Starter',
        description: 'High energy & protein for rapid chick development',
        feedCategory: 'Poultry',
        poultryType: 'Broiler',
        ingredientNames: [
            'MAIZE',
            'SOYABEAN MEAL',
            'FISHMEAL 65%',
            'WHEAT OFFALS',
            'PALM OIL',
            'BONE MEAL',
            'LYSINE',
            'METHIONINE',
            'FISH PREMIX'
        ]
    },
    {
        name: 'Layer Production',
        description: 'High calcium and balanced nutrients for egg production',
        feedCategory: 'Poultry',
        poultryType: 'Layer',
        ingredientNames: [
            'MAIZE',
            'SOYABEAN MEAL',
            'WHEAT OFFALS',
            'LIMESTONE',
            'BONE MEAL',
            'OYSTER SHELL',
            'FISH PREMIX',
            'SALT'
        ]
    }
];

const seedTemplates = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/aquafeed');
        console.log('Connected to MongoDB');

        for (const templateData of templates) {
            await FeedTemplate.findOneAndUpdate(
                { name: templateData.name },
                templateData,
                { upsert: true, new: true }
            );
            console.log(`Seeded template: ${templateData.name}`);
        }

        console.log('Template seeding complete!');
        process.exit(0);
    } catch (error) {
        console.error('Seeding error:', error);
        process.exit(1);
    }
};

seedTemplates();
