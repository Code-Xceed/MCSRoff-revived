import { describe, it, expect, vi } from 'vitest';
import { createAuthService } from '../src/services/authService.js';
import * as jwt from '../src/utils/jwt.js';

describe('authService', () => {
  const mockRepositories = {
    modSessions: {
      findActiveByAccessToken: vi.fn(),
      replaceActiveForUserScope: vi.fn()
    }
  };

  const authService = createAuthService({
    repositories: mockRepositories,
    parseCookies: vi.fn(),
    sanitizeDisplayText: (text) => text,
    webSessionTtlSeconds: 3600,
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 7200
  });

  describe('issueModSession', () => {
    it('issues a JWT token and stores the session', async () => {
      vi.spyOn(jwt, 'signSessionToken').mockReturnValue('mock.jwt.token');
      const userId = '123';
      const scope = 'launcher';
      
      const expectedSession = { id: 'mock-id' };
      mockRepositories.modSessions.replaceActiveForUserScope.mockResolvedValueOnce(expectedSession);

      const result = await authService.issueModSession(userId, scope);

      expect(jwt.signSessionToken).toHaveBeenCalled();
      expect(mockRepositories.modSessions.replaceActiveForUserScope).toHaveBeenCalledWith(
        userId,
        scope,
        expect.objectContaining({
          userId,
          scope,
          accessToken: 'mock.jwt.token'
        }),
        expect.any(Number)
      );
      expect(result).toBe(expectedSession);
    });
  });
});
