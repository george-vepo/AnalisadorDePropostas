import { Router } from 'express';

export const systemRouter = Router();

systemRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime()),
    version: process.env.npm_package_version ?? 'unknown',
    time: new Date().toISOString(),
  });
});
