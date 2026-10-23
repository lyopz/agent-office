// Whether the 3D brains turn on their own. The owner can stop it on the Brain and Brains pages; it is remembered.
import { create } from 'zustand';

const KEY = 'brain:spin';
const saved = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };

export const useSpin = create<{ on: boolean; toggle(): void }>((set, get) => ({
  on: saved(),
  toggle() { const on = !get().on; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private window */ } set({ on }); },
}));
