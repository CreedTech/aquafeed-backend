import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import {
    getStandards,
    getStandardById,
    getDefaultStandard
} from './standard.controller';

const router = Router();

// All standard routes require auth
router.use(requireAuth);

/**
 * @route   GET /api/v1/standards
 * @desc    Get all feed standards
 * @access  Private
 */
router.get('/', getStandards);

/**
 * @route   GET /api/v1/standards/default
 * @desc    Get default standard (AquaFeed Pro 3mm)
 * @access  Private
 */
router.get('/default', getDefaultStandard);

/**
 * @route   GET /api/v1/standards/:id
 * @desc    Get single standard by ID
 * @access  Private
 */
router.get('/:id', getStandardById);

export default router;
