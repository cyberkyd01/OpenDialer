import { Router } from 'express';
import { campaignAgentsSchema, campaignCreateSchema, campaignStatusUpdateSchema, campaignUpdateSchema, listCreateSchema, listUpdateSchema } from '@opendialer/shared';
import { requireRole } from '../auth.js';
import type { Ctx } from '../context.js';
import type { Engine } from '../engine.js';
import { idParam, parse, wrap } from '../errors.js';
import { audit } from '../services/audit.js';
import {
  campaignStats,
  campaignsForUser,
  createCampaign,
  deleteCampaign,
  getCampaign,
  getCampaignAgentIds,
  listCampaigns,
  resetLeads,
  setCampaignAgents,
  setCampaignStatus,
  updateCampaign,
} from '../services/campaigns.js';
import { createList, deleteList, getList, listLists, updateList } from '../services/lists.js';
import { findScript } from '../services/scripts.js';

export function campaignRoutes(ctx: Ctx, engine: Engine) {
  const r = Router();
  const { db } = ctx;

  const onlineCount = (campaignId: number) => [...engine.sessions.values()].filter((s) => s.campaignId === campaignId).length;

  r.get('/campaigns', requireRole('agent'), (req, res) => {
    const u = req.user!;
    res.json(u.role === 'agent' ? campaignsForUser(db, u.id, u.role) : listCampaigns(db));
  });

  r.get(
    '/campaigns/:id',
    requireRole('agent'),
    wrap((req, res) => {
      const c = getCampaign(db, idParam(req));
      res.json({ ...c, script: findScript(db, c.scriptId), agentIds: getCampaignAgentIds(db, c.id) });
    }),
  );

  r.get('/campaigns/:id/stats', requireRole('agent'), wrap((req, res) => res.json(campaignStats(db, idParam(req), onlineCount(idParam(req))))));

  r.post(
    '/campaigns',
    requireRole('supervisor'),
    wrap((req, res) => {
      const c = createCampaign(db, parse(campaignCreateSchema, req.body));
      audit(db, req.user!.id, 'campaign.create', 'campaign', c.id, { name: c.name });
      res.status(201).json(c);
    }),
  );

  r.patch(
    '/campaigns/:id',
    requireRole('supervisor'),
    wrap((req, res) => {
      const id = idParam(req);
      const patch = parse(campaignUpdateSchema, req.body);
      const c = updateCampaign(db, id, patch);
      audit(db, req.user!.id, 'campaign.update', 'campaign', id, Object.keys(patch));
      ctx.bus.emitDomain('leads.available', { campaignId: id });
      res.json(c);
    }),
  );

  r.post(
    '/campaigns/:id/status',
    requireRole('supervisor'),
    wrap((req, res) => {
      const id = idParam(req);
      const { status } = parse(campaignStatusUpdateSchema, req.body);
      const c = setCampaignStatus(db, id, status);
      audit(db, req.user!.id, 'campaign.status', 'campaign', id, { status });
      ctx.bus.emitDomain('campaign.status', { campaignId: id, status });
      res.json(c);
    }),
  );

  r.put(
    '/campaigns/:id/agents',
    requireRole('supervisor'),
    wrap((req, res) => {
      const id = idParam(req);
      const { userIds } = parse(campaignAgentsSchema, req.body);
      res.json({ agentIds: setCampaignAgents(db, id, userIds) });
      audit(db, req.user!.id, 'campaign.agents', 'campaign', id, { userIds });
    }),
  );

  r.post(
    '/campaigns/:id/reset-leads',
    requireRole('supervisor'),
    wrap((req, res) => {
      const id = idParam(req);
      const listId = req.body?.listId ? Number(req.body.listId) : undefined;
      const onlyStatus = Array.isArray(req.body?.onlyStatus) ? (req.body.onlyStatus as string[]) : undefined;
      const changed = resetLeads(db, id, { listId, onlyStatus });
      audit(db, req.user!.id, 'campaign.reset', 'campaign', id, { changed, listId, onlyStatus });
      ctx.bus.emitDomain('leads.available', { campaignId: id });
      res.json({ changed });
    }),
  );

  r.delete(
    '/campaigns/:id',
    requireRole('admin'),
    wrap((req, res) => {
      const id = idParam(req);
      deleteCampaign(db, id);
      audit(db, req.user!.id, 'campaign.delete', 'campaign', id);
      res.json({ ok: true });
    }),
  );

  /* ---------- lists ---------- */

  r.get('/campaigns/:id/lists', requireRole('agent'), wrap((req, res) => res.json(listLists(db, idParam(req)))));

  r.post(
    '/campaigns/:id/lists',
    requireRole('supervisor'),
    wrap((req, res) => {
      const id = idParam(req);
      getCampaign(db, id);
      const l = createList(db, id, parse(listCreateSchema, req.body));
      audit(db, req.user!.id, 'list.create', 'list', l.id, { name: l.name, campaignId: id });
      res.status(201).json(l);
    }),
  );

  r.get('/lists/:id', requireRole('agent'), wrap((req, res) => res.json(getList(db, idParam(req)))));

  r.patch(
    '/lists/:id',
    requireRole('supervisor'),
    wrap((req, res) => {
      const id = idParam(req);
      const l = updateList(db, id, parse(listUpdateSchema, req.body));
      audit(db, req.user!.id, 'list.update', 'list', id);
      ctx.bus.emitDomain('leads.available', { campaignId: l.campaignId });
      res.json(l);
    }),
  );

  r.delete(
    '/lists/:id',
    requireRole('supervisor'),
    wrap((req, res) => {
      const id = idParam(req);
      deleteList(db, id);
      audit(db, req.user!.id, 'list.delete', 'list', id);
      res.json({ ok: true });
    }),
  );

  return r;
}
