import type { HealthStatusPayload } from '@cinema/shared-types';
import { toUtcIsoString } from '@cinema/shared-utils';
import { HealthRepository } from './health.repository.js';

export class HealthService {
  private readonly repository: HealthRepository;

  constructor(repository: HealthRepository = new HealthRepository()) {
    this.repository = repository;
  }

  public getHealthStatus(): HealthStatusPayload {
    const snapshot = this.repository.getServiceSchemaSnapshot();
    return {
      status: 'ok',
      service: snapshot.service,
      schema: snapshot.schema,
      timestamp: toUtcIsoString(),
    };
  }
}
