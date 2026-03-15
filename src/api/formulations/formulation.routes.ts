import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import {
    calculateFormulation,
    previewFormulationFix,
    evaluateAlternativeOptions,
    getAlternativeCacheResult,
    getFormulationPricing,
    getFormulationSummary,
    getFormulationAnalyticsOverview,
    getFormulationAnalyticsTrends,
    getCalculationLedger,
    exportFormulationReport,
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
 * @route   POST /api/v1/formulations/preview-fix
 * @desc    Preview one-tap remediations for infeasible formulations
 * @access  Private
 */
router.post('/preview-fix', previewFormulationFix);
router.post('/alternatives/evaluate', evaluateAlternativeOptions);
router.get('/alternatives/cache/:cacheKey', getAlternativeCacheResult);
router.get('/unlock-fee', getFormulationPricing);
router.get('/summary', getFormulationSummary);
router.get('/analytics/overview', getFormulationAnalyticsOverview);
router.get('/analytics/trends', getFormulationAnalyticsTrends);
router.get('/:id/calculation-ledger', getCalculationLedger);
router.post('/:id/export', exportFormulationReport);

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
