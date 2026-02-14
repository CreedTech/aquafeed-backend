import { Router } from 'express';
import * as controller from './template.controller';

const router = Router();

router.get('/', controller.getAllTemplates);
router.post('/', controller.createTemplate);
router.patch('/:id', controller.updateTemplate);

export default router;
