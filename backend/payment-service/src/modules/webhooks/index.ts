import type { ModuleDescriptor } from '../../common/types/index.js';

/**
 * Module Boundary Placeholder: webhooks
 * Owner: TV4
 * Responsibility: HMAC-SHA256 webhook signature verification, replay protection, and event idempotency (D-09)
 * Note: Do not implement business logic during project scaffolding.
 */
export const WEBHOOKS_MODULE: ModuleDescriptor = {
  moduleName: 'webhooks',
  owner: 'TV4',
  service: 'payment-service',
  schema: 'payment',
};
