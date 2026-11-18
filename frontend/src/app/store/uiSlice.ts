import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface UiState {
  sidebarOpen: boolean;
  selectedCinemaId: string | null;
}

const initialState: UiState = {
  sidebarOpen: false,
  selectedCinemaId: null,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setSidebarOpen(state, action: PayloadAction<boolean>) {
      state.sidebarOpen = action.payload;
    },
    setSelectedCinemaId(state, action: PayloadAction<string | null>) {
      state.selectedCinemaId = action.payload;
    },
  },
});

export const { setSidebarOpen, setSelectedCinemaId } = uiSlice.actions;
export const uiReducer = uiSlice.reducer;

