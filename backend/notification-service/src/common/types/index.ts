import type { DatabaseSchemaName, ServiceName } from '@cinema/shared-types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export interface ModuleDescriptor {
  moduleName: string;
  owner: string;
  service: ServiceName;
  schema: DatabaseSchemaName;
}
