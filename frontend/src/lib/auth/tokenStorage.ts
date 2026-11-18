/**
 * In-memory access token holder placeholder (TV1 — Auth).
 * Per ARCHITECTURE.md & SECURITY.md: access tokens are stored in memory only;
 * refresh tokens use HttpOnly, Secure, SameSite cookies.
 */

let accessToken: string | null = null;

export const tokenStorage = {
  getAccessToken(): string | null {
    return accessToken;
  },
  setAccessToken(token: string | null): void {
    accessToken = token;
  },
  clearAccessToken(): void {
    accessToken = null;
  },
};

