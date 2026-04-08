import { expect, vi } from 'vitest';

// Global test setup for backend
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent'; // Disable pino logs in tests by default

// Ensure keys are mocked for JWT signing during tests
if (!process.env.JWT_PRIVATE_KEY_PATH) {
  process.env.JWT_PRIVATE_KEY_PATH = '';
  process.env.JWT_PUBLIC_KEY_PATH = '';
}
