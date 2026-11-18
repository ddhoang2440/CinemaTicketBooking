import type { ModuleDescriptor } from '../../common/types/index.js';

/**
 * Module Boundary Placeholder: bookings
 * Owner: TV4
 * Responsibility: Customer and guest booking lifecycle, 120-minute cancellation cutoff (D-07, D-08)
 * Note: Do not implement business logic during project scaffolding.
 */
export const BOOKINGS_MODULE: ModuleDescriptor = {
  moduleName: 'bookings',
  owner: 'TV4',
  service: 'core-service',
  schema: 'core',
};
