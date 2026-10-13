import { Router } from 'express';
import { actor } from '../auth/middleware.js';
import { parseId, parsePage } from '../http/input.js';
import type { CampaignService } from './service.js';
export function createCampaignRoutes(service: CampaignService): Router {
    const router = Router();
    router.post('/', async (req, res) => { res.status(201).json(await service.create(actor(req).member.id, req.body)); });
    router.get('/', async (req, res) => { res.json(await service.list(actor(req).member.id, parsePage(req.query.page))); });
    router.get('/:campaignId', async (req, res) => { res.json(await service.get(actor(req).member.id, parseId(req.params.campaignId))); });
    router.patch('/:campaignId/budget', async (req, res) => { res.json(await service.changeBudget(actor(req).member.id, parseId(req.params.campaignId), req.body)); });
    router.patch('/:campaignId/status', async (req, res) => { res.json(await service.changeStatus(actor(req).member.id, parseId(req.params.campaignId), req.body)); });
    return router;
}
