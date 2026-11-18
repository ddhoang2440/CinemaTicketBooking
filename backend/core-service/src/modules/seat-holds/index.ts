import type { ModuleDescriptor } from '../../common/types/index.js';

/**
 * Module Boundary Placeholder: seat-holds
 * Owner: TV3
 * Responsibility: Authoritative seat holds (300s TTL, max 8 seats) and atomic seat allocations (D-05, D-06, D-12)
 * Note: Do not implement business logic during project scaffolding.
 */
export const SEAT_HOLDS_MODULE: ModuleDescriptor = {
  moduleName: 'seat-holds',
  owner: 'TV3',
  service: 'core-service',
  schema: 'core',
};
