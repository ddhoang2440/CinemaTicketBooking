import type { ModuleDescriptor } from '../../common/types/index.js';

/**
 * Module Boundary Placeholder: templates
 * Owner: TV5
 * Responsibility: Vietnamese-localized notification templates (Asia/Ho_Chi_Minh display, VND formatting)
 * Note: Do not implement business logic during project scaffolding.
 */
export const TEMPLATES_MODULE: ModuleDescriptor = {
  moduleName: 'templates',
  owner: 'TV5',
  service: 'notification-service',
  schema: 'notification',
};

export * from './template.service.js';
