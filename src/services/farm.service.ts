import FarmProfile, { IFarmProfile } from '../models/FarmProfile';
import mongoose from 'mongoose';

/**
 * Ensures a user has a farm profile. If not, creates a default one.
 * @param userId - The ID of the user
 * @returns The user's primary farm profile
 */
export const ensureFarmProfile = async (userId: string): Promise<IFarmProfile> => {
    let farm = await FarmProfile.findOne({ userId, isDefault: true });

    if (!farm) {
        // Double check if any farm exists, if so make the first one default
        const anyFarm = await FarmProfile.findOne({ userId });
        if (anyFarm) {
            anyFarm.isDefault = true;
            await anyFarm.save();
            return anyFarm;
        }

        // Create default farm if none exists
        console.log(`Creating default farm for user ${userId}`);
        farm = await FarmProfile.create({
            userId: new mongoose.Types.ObjectId(userId),
            name: 'My Main Farm',
            location: {
                state: 'Lagos',
                lga: 'Ikeja',
                address: 'Main Location'
            },
            fishType: 'Catfish', // Defaulting to Catfish
            isDefault: true,
            ponds: []
        });
    }

    return farm;
};
