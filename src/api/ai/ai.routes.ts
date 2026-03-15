import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import {
    cancelFormulationAnalystJob,
    createAiConversation,
    createFormulationAnalystThread,
    getAiConversationByUuid,
    getAiConversations,
    getFormulationAnalystJobStatus,
    getFormulationAnalystModels,
    getFormulationAnalystThreadMessages,
    getFormulationAnalystThreads,
    postAiConversationMessage,
    postFormulationAnalystScenario,
    submitFormulationAnalystThreadMessage,
    streamFormulationAnalystJob,
    updateFormulationAnalystThreadSettings,
    postFormulationAnalystThreadMessage,
    queryFormulationAnalyst,
    whatIfFormulationAnalyst
} from './ai.controller';

const router = Router();

router.use(requireAuth);

router.get('/conversations', getAiConversations);
router.get('/conversations/:uuid', getAiConversationByUuid);
router.post('/conversations', createAiConversation);
router.post('/conversations/:uuid/messages', postAiConversationMessage);

router.post('/formulation-analyst/query', queryFormulationAnalyst);
router.post('/formulation-analyst/what-if', whatIfFormulationAnalyst);
router.get('/formulation-analyst/models', getFormulationAnalystModels);
router.post('/formulation-analyst/threads', createFormulationAnalystThread);
router.get('/formulation-analyst/threads', getFormulationAnalystThreads);
router.patch('/formulation-analyst/threads/:threadId/settings', updateFormulationAnalystThreadSettings);
router.get('/formulation-analyst/threads/:threadId/messages', getFormulationAnalystThreadMessages);
router.post('/formulation-analyst/threads/:threadId/messages', postFormulationAnalystThreadMessage);
router.post('/formulation-analyst/threads/:threadId/messages/submit', submitFormulationAnalystThreadMessage);
router.post('/formulation-analyst/threads/:threadId/scenario', postFormulationAnalystScenario);
router.get('/formulation-analyst/jobs/:jobId', getFormulationAnalystJobStatus);
router.get('/formulation-analyst/jobs/:jobId/stream', streamFormulationAnalystJob);
router.post('/formulation-analyst/jobs/:jobId/cancel', cancelFormulationAnalystJob);

export default router;
