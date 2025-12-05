import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import * as inventoryController from './inventory.controller';

const router = Router();

router.use(requireAuth);

router.post('/', inventoryController.addStock);
router.get('/', inventoryController.getInventory);
router.patch('/:id', inventoryController.updateStock);
router.post('/deduct', inventoryController.deductStock);

export default router;
