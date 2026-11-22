import { Router } from 'express';
import { requireServiceAuth } from '../../common/middleware/serviceAuth.js';
import { sendNotificationHandler } from './delivery.controller.js';

export const deliveryRouter = Router();

/**
 * POST /internal/notifications/send
 * Authenticated via signed service JWT (D-13)
 * Resilient, non-blocking delivery (D-10, CT-22)
 */
deliveryRouter.post('/send', requireServiceAuth('notifications:send'), sendNotificationHandler);
