import { Router } from 'express';
import { getHealth } from './health.controller.js';

export const healthRouter = Router();

healthRouter.get('/', getHealth);
healthRouter.get('/live', getHealth);
healthRouter.get('/ready', getHealth);
