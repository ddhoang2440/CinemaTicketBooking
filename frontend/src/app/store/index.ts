import { configureStore } from '@reduxjs/toolkit';
import { uiReducer } from './uiSlice';

/**
 * Shared Redux Toolkit store for client-side UI state only.
 * Per ARCHITECTURE.md: server state belongs in TanStack Query, not Redux.
 */
export const store = configureStore({
  reducer: {
    ui: uiReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

