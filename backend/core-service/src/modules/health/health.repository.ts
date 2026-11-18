import type { DatabaseSchemaName, ServiceName } from '@cinema/shared-types';
import { env } from '../../config/env.js';

export interface HealthRepositorySnapshot {
  service: ServiceName;
  schema: DatabaseSchemaName;
}

export class HealthRepository {
  public getServiceSchemaSnapshot(): HealthRepositorySnapshot {
    return {
      service: env.SERVICE_NAME,
      schema: env.DB_SCHEMA,
    };
  }
}
