import { create } from 'zustand';

interface AuthState {
  isAuthenticated: boolean;
  user: { id: string; username: string; avatar?: string; email?: string } | null;
  setAuthenticated: (user: AuthState['user']) => void;
  setUnauthenticated: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  setAuthenticated: (user) => set({ isAuthenticated: true, user }),
  setUnauthenticated: () => set({ isAuthenticated: false, user: null }),
}));
