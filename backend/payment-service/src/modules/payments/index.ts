import type { ModuleDescriptor } from '../../common/types/index.js';

/**
 * Module Boundary Placeholder: payments
 * Owner: TV4
 * Responsibility: Mock payment adapter, payment intent initiation, and status queries (D-09, D-18)
 * Note: Do not implement business logic during project scaffolding.
 */
export const PAYMENTS_MODULE: ModuleDescriptor = {
  moduleName: 'payments',
  owner: 'TV4',
  service: 'payment-service',
  schema: 'payment',
};
