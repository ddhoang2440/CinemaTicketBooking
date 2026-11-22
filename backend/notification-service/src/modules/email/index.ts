import type { ModuleDescriptor } from '../../common/types/index.js';

/**
 * Module Boundary Placeholder: email
 * Owner: TV5
 * Responsibility: Email dispatch requests for booking confirmations, QR tickets, and cancellations/refunds
 * Note: Do not implement business logic during project scaffolding.
 */
export const EMAIL_MODULE: ModuleDescriptor = {
  moduleName: 'email',
  owner: 'TV5',
  service: 'notification-service',
  schema: 'notification',
};

export * from './email.transport.js';
