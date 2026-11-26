import { create } from 'zustand';

/* Whether Settings is up over the page (SettingsOverlay.jsx). Its own file,
   so any page can open it without importing the component. */
export const useSettingsOverlay = create((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

export const openSettings = () => useSettingsOverlay.getState().show();
