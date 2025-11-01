import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import {
    calculateFormulation,
    unlockFormulation,
    getFormulations
} from './formulation.controller';

const router = Router();

// All formulation routes require auth
router.use(requireAuth);

/**
 * @route   POST /api/v1/formulations/calculate
 * @desc    Calculate optimal feed formulation (The "Joggler")
 * @access  Private
 */
router.post('/calculate', calculateFormulation);

/**
 * @route   POST /api/v1/formulations/:id/unlock
 * @desc    Unlock full formulation details (requires payment)
 * @access  Private
 */
router.post('/:id/unlock', unlockFormulation);

/**
 * @route   GET /api/v1/formulations
 * @desc    Get user's formulation history
 * @access  Private
 */
router.get('/', getFormulations);

export default router;
