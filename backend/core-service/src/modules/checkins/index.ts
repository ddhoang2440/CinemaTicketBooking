import type { ModuleDescriptor } from '../../common/types/index.js';

/**
 * Module Boundary Placeholder: checkins
 * Owner: TV5
 * Responsibility: Staff QR ticket verification and one-time check-in within [-30m, +30m] window (D-10)
 * Note: Do not implement business logic during project scaffolding.
 */
export const CHECKINS_MODULE: ModuleDescriptor = {
  moduleName: 'checkins',
  owner: 'TV5',
  service: 'core-service',
  schema: 'core',
};
