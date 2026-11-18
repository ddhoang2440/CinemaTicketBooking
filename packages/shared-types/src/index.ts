/**
 * Cross-service transport types only.
 * Per architectural rules: NO direct imports of database models from any service.
 */

export type ServiceName = 'core-service' | 'payment-service' | 'notification-service';

export type DatabaseSchemaName = 'core' | 'payment' | 'notification';

export type UserRole = 'customer' | 'staff' | 'manager' | 'admin';

/**
 * ACCEPTED D-18: Monetary amounts are stored and transported as integer VND.
 */
export type VndAmount = number;

/**
 * ACCEPTED D-18: Timestamps are transported in UTC ISO-8601 format (e.g. "2026-12-20T12:30:00Z").
 */
export type UtcIsoTimestamp = string;

export interface ApiMeta {
  requestId: string;
}

export interface PaginationMeta extends ApiMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccessResponse<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiPaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: ApiErrorPayload;
  meta: ApiMeta;
}

export interface HealthStatusPayload {
  status: 'ok' | 'degraded';
  service: ServiceName;
  schema: DatabaseSchemaName;
  timestamp: UtcIsoTimestamp;
}

/**
 * ACCEPTED D-13: Service-to-service authentication uses signed service JWTs.
 */
export interface ServiceJwtClaims {
  iss: string;
  sub: ServiceName;
  aud: ServiceName | string;
  iat: number;
  exp: number;
  jti: string;
  scope: string[];
}
