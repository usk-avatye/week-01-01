import { Router } from 'express';
import { parseId, parsePage } from '../http/input.js';
import type { AdminQueries } from './queries.js';
export function createAdminRoutes(queries: AdminQueries): Router {
    const router = Router();
    router.get('/campaigns', async (req, res) => { res.json(await queries.list(parsePage(req.query.page))); });
    router.get('/campaigns/:campaignId', async (req, res) => { res.json(await queries.get(parseId(req.params.campaignId))); });
    router.get('/campaigns/:campaignId/executions', async (req, res) => { res.json(await queries.history(parseId(req.params.campaignId), parsePage(req.query.page))); });
    return router;
}
