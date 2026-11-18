import type { ServiceName } from '@cinema/shared-types';

export interface ServiceEndpointDescriptor {
  service: ServiceName;
  baseUrl: string;
  owner: string;
}

