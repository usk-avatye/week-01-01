import { Router } from 'express';
import { actor } from '../auth/middleware.js';
import { bodyFields, parseAmount, parseId, parsePage } from '../http/input.js';
import type { ExecutionService } from './service.js';
export function createExecutionRoutes(service: ExecutionService): Router {
    const router = Router();
    router.post('/:campaignId/preparations', async (req, res) => {
        bodyFields(req.body ?? {}, []);
        res.status(201).json(await service.prepare(actor(req).member.id, parseId(req.params.campaignId)));
    });
    router.get('/:campaignId/preparations', async (req, res) => {
        res.json(await service.list(actor(req).member.id, parseId(req.params.campaignId), parsePage(req.query.page), true));
    });
    router.get('/:campaignId/executions', async (req, res) => {
        res.json(await service.list(actor(req).member.id, parseId(req.params.campaignId), parsePage(req.query.page), false));
    });
    router.get('/:campaignId/executions/:requestId', async (req, res) => {
        res.json(await service.get(actor(req).member.id, parseId(req.params.campaignId), parseId(req.params.requestId)));
    });
    router.post('/:campaignId/executions/:requestId', async (req, res) => {
        const fields = bodyFields(req.body, ['amount']);
        res.json(await service.execute(actor(req).member.id, parseId(req.params.campaignId), parseId(req.params.requestId), parseAmount(fields.amount)));
    });
    return router;
}
