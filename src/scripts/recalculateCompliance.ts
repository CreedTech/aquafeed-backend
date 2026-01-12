
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Formulation from '../models/Formulation';
import FeedStandard from '../models/FeedStandard';
import complianceService from '../services/compliance.service';
import path from 'path';

// Load environment variables from backend root
dotenv.config({ path: path.join(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aquafeed';

async function recalculateCompliance() {
    try {
        console.log('🔄 Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected successfully!\n');

        console.log('Registered models:', mongoose.modelNames());

        // Force import usage
        console.log('Standard Model Loaded:', FeedStandard.modelName);

        // Ensure FeedStandard is registered
        if (!mongoose.modelNames().includes('FeedStandard')) {
            console.error('❌ FeedStandard model NOT registered! Imports might be failing.');
            // Force it if possible (though import should have done it)
            // logic here
        }

        console.log('🔍 Fetching all formulations...');
        const formulations = await Formulation.find().populate('standardUsed');
        console.log(`Found ${formulations.length} formulations to process.\n`);

        // Fetch a fallback standard (Default) in case of orphans
        const fallbackStandard = await FeedStandard.findOne({ isDefault: true }) || await FeedStandard.findOne();
        if (!fallbackStandard) {
            console.error('❌ No Feed Standards found in DB! Cannot verify compliance.');
            process.exit(1);
        }
        console.log(`ℹ️  Using fallback standard: ${fallbackStandard.name} (for orphaned records)`);

        let updatedCount = 0;
        let unchangedCount = 0;
        let errorCount = 0;
        let rescuedCount = 0;

        for (const formulation of formulations) {
            try {
                let standard = formulation.standardUsed as any;

                // Handle orphaned formulations (standard deleted)
                if (!standard) {
                    console.log(`⚠️  Orphaned formulation ${formulation._id}. Reassigning to fallback: ${fallbackStandard.name}`);
                    formulation.standardUsed = fallbackStandard._id as any;
                    standard = fallbackStandard;
                    rescuedCount++;
                }

                // CRITICAL: Convert Mongoose subdocument to plain object
                // Mongoose wraps subdocuments in a special object where actual data is in _doc
                const rawTarget = standard.targetNutrients;
                const targetNutrients = rawTarget.toObject
                    ? rawTarget.toObject()
                    : rawTarget._doc || rawTarget;

                // Re-run compliance check with NEW logic (including max-only fix)
                const complianceResult = complianceService.checkCompliance(
                    formulation.actualNutrients,
                    targetNutrients,
                    standard.tolerance || 2 // Default to 2 if missing, though standard should have it
                );

                // Check if anything changed
                const oldColor = formulation.complianceColor;
                const newColor = complianceResult.color;
                const oldMatch = formulation.qualityMatchPercentage;
                const newMatch = complianceResult.qualityMatch;

                if (oldColor !== newColor || Math.abs(oldMatch - newMatch) > 0.1) {
                    console.log(`📝 Updating ${formulation._id}:`);
                    console.log(`   Color: ${oldColor} -> ${newColor}`);
                    console.log(`   Match: ${oldMatch}% -> ${newMatch}%`);

                    formulation.complianceColor = newColor;
                    formulation.qualityMatchPercentage = newMatch;

                    await formulation.save();
                    updatedCount++;
                } else {
                    unchangedCount++;
                }

            } catch (err) {
                console.error(`❌ Error processing formulation ${formulation._id}:`, err);
                errorCount++;
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('COMPLIANCE RECALCULATION COMPLETE');
        console.log('='.repeat(60));
        console.log(`Total Processed: ${formulations.length}`);
        console.log(`Updated:         ${updatedCount}`);
        console.log(`Unchanged:       ${unchangedCount}`);
        console.log(`Errors:          ${errorCount}`);

    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('\nDatabase connection closed');
        process.exit(0);
    }
}

// Run the script
recalculateCompliance();
