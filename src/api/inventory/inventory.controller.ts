import { Request, Response } from 'express';
import UserInventory from '../../models/UserInventory';
import Ingredient from '../../models/Ingredient';
import { ensureFarmProfile } from '../../services/farm.service';

/**
 * Add stock (restock or new ingredient)
 */
export const addStock = async (req: Request, res: Response) => {
    try {
        const { ingredientId, quantityKg, pricePerKg, localDate } = req.body;
        const userId = req.session.userId;

        if (quantityKg <= 0 || pricePerKg < 0) {
            res.status(400).json({ error: 'Quantity must be positive and price non-negative' });
            return;
        }

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const farm = await ensureFarmProfile(userId);

        // Check if ingredient exists
        const ingredient = await Ingredient.findById(ingredientId);
        if (!ingredient) {
            res.status(404).json({ error: 'Ingredient not found' });
            return;
        }

        // Find existing inventory item or create new
        let inventoryItem = await UserInventory.findOne({
            userId,
            farmId: farm._id,
            ingredientId
        });

        if (inventoryItem) {
            // Update existing stock
            // Weighted average price calculation could be implemented here, 
            // but for now we just update the "last paid price"
            inventoryItem.currentStockKg += Number(quantityKg);
            inventoryItem.userLocalPrice = Number(pricePerKg);
            inventoryItem.lastRestockDate = localDate ? new Date(localDate) : new Date();
            await inventoryItem.save();
        } else {
            // Create new inventory record
            inventoryItem = await UserInventory.create({
                userId,
                farmId: farm._id,
                ingredientId,
                currentStockKg: Number(quantityKg),
                userLocalPrice: Number(pricePerKg),
                lastRestockDate: localDate ? new Date(localDate) : new Date(),
                lowStockThreshold: 50 // Default threshold
            });
        }

        res.status(200).json({ message: 'Stock updated successfully', inventory: inventoryItem });

    } catch (error) {
        console.error('Add Stock Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get all inventory items with ingredient details
 */
export const getInventory = async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId;
        if (!userId) return;

        const inventory = await UserInventory.find({ userId })
            .populate('ingredientId', 'name category defaultPrice')
            .sort({ currentStockKg: 1 }); // Show low stock first

        // Add computed status (Low Stock etc)
        const inventoryWithStatus = inventory.map(item => {
            const doc = item.toObject();
            return {
                ...doc,
                isLowStock: item.currentStockKg < item.lowStockThreshold,
                value: item.currentStockKg * item.userLocalPrice
            };
        });

        const totalValue = inventoryWithStatus.reduce((acc, curr) => acc + curr.value, 0);

        res.json({
            data: inventoryWithStatus,
            summary: {
                totalItems: inventory.length,
                totalValue
            }
        });

    } catch (error) {
        console.error('Get Inventory Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Manually update stock (e.g. wastage or correction)
 */
export const updateStock = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { currentStockKg, lowStockThreshold } = req.body;
        const userId = req.session.userId;

        const item = await UserInventory.findOne({ _id: id, userId });
        if (!item) {
            res.status(404).json({ error: 'Inventory item not found' });
            return;
        }

        if (currentStockKg !== undefined) item.currentStockKg = Number(currentStockKg);
        if (lowStockThreshold !== undefined) item.lowStockThreshold = Number(lowStockThreshold);

        await item.save();

        res.json({ message: 'Stock updated', inventory: item });

    } catch (error) {
        console.error('Update Stock Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Deduct stock (Usage)
 */
export const deductStock = async (req: Request, res: Response) => {
    try {
        const { ingredientId, quantityKg } = req.body;
        const userId = req.session.userId;

        if (Number(quantityKg) <= 0) {
            res.status(400).json({ error: 'Deduction quantity must be positive' });
            return;
        }

        const item = await UserInventory.findOne({ userId, ingredientId });

        if (!item) {
            res.status(404).json({ error: 'Ingredient not found in inventory' });
            return;
        }

        if (item.currentStockKg < quantityKg) {
            res.status(400).json({
                error: 'Insufficient stock',
                current: item.currentStockKg,
                requested: quantityKg
            });
            return;
        }

        item.currentStockKg -= Number(quantityKg);
        await item.save();

        res.json({ message: 'Stock deducted', remaining: item.currentStockKg });

    } catch (error) {
        console.error('Deduct Stock Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
