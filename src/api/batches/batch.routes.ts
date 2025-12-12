import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import * as batchController from './batch.controller';

const router = Router();

router.use(requireAuth);

router.post('/', batchController.createBatch);
router.get('/', batchController.getBatches);
router.post('/:id/feed', batchController.logFeeding);
router.patch('/:id/biomass', batchController.updateBiomass); // Updates weight & mortality
router.post('/:id/harvest', batchController.closeBatch);

export default router;
