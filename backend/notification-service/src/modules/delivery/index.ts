import type { ModuleDescriptor } from '../../common/types/index.js';

/**
 * Module Boundary Placeholder: delivery
 * Owner: TV5
 * Responsibility: Notification delivery status logging and idempotent retry tracking
 * Note: Do not implement business logic during project scaffolding.
 */
export const DELIVERY_MODULE: ModuleDescriptor = {
  moduleName: 'delivery',
  owner: 'TV5',
  service: 'notification-service',
  schema: 'notification',
};
