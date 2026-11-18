import type { ApiErrorResponse, ApiSuccessResponse } from '@cinema/shared-types';
import { tokenStorage } from '@/lib/auth/tokenStorage';

export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4001/api/v1';

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly requestId?: string;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/**
 * Shared API client configuration placeholder.
 * Attaches Authorization bearer header if present and parses standard API envelopes.
 */
export async function apiFetch<T>(
  endpoint: string,
  init: RequestInit = {},
): Promise<ApiSuccessResponse<T>> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  const headers = new Headers(init.headers);

  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  const token = tokenStorage.getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    let errorBody: Partial<ApiErrorResponse> | undefined;
    try {
      errorBody = (await response.json()) as Partial<ApiErrorResponse>;
    } catch {
      // Fallback when error response is not JSON
    }
    throw new ApiClientError(
      response.status,
      errorBody?.error?.code ?? 'HTTP_ERROR',
      errorBody?.error?.message ?? `Request failed with status ${response.status}`,
      errorBody?.meta?.requestId,
    );
  }

  return (await response.json()) as ApiSuccessResponse<T>;
}

