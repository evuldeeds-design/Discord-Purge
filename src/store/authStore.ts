import { create } from 'zustand';

interface AuthState {
  isAuthenticated: boolean;
  user: { id: string; username: string; avatar?: string; email?: string } | null;
  guilds: any[] | null;
  isLoading: boolean;
  error: string | null;
  setAuthenticated: (user: AuthState['user']) => void;
  setUnauthenticated: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setGuilds: (guilds: any[]) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  guilds: null,
  isLoading: false,
  error: null,
  setAuthenticated: (user) => set({ isAuthenticated: true, user, isLoading: false, error: null }),
  setUnauthenticated: () => set({ isAuthenticated: false, user: null, guilds: null, isLoading: false, error: null }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error, isLoading: false }),
  setGuilds: (guilds) => set({ guilds, isLoading: false }),
}));
