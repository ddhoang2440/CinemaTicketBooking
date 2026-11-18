import type { ModuleDescriptor } from '../../common/types/index.js';

/**
 * Module Boundary Placeholder: refunds
 * Owner: TV4
 * Responsibility: Mock refund execution and late-payment compensation workflows (D-07, D-09)
 * Note: Do not implement business logic during project scaffolding.
 */
export const REFUNDS_MODULE: ModuleDescriptor = {
  moduleName: 'refunds',
  owner: 'TV4',
  service: 'payment-service',
  schema: 'payment',
};
