import React, { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAuthStore } from './store/authStore';

interface DiscordUser {
  id: string;
  username: string;
  avatar?: string;
  email?: string;
}

function App() {
  const { isAuthenticated, user, isLoading, error, setAuthenticated, setUnauthenticated, setLoading, setError } = useAuthStore();

  useEffect(() => {
    // Listen for the auth_started event from the Rust backend
    const unlistenStarted = listen('auth_started', () => {
      setLoading(true);
      setError(null);
    });

    // Listen for the auth_success event from the Rust backend
    const unlistenSuccess = listen('auth_success', (event) => {
      const userProfile = event.payload as DiscordUser;
      setAuthenticated(userProfile);
    });

    // Cleanup the event listeners when the component unmounts
    return () => {
      unlistenStarted.then(f => f());
      unlistenSuccess.then(f => f());
    };
  }, [setAuthenticated, setLoading, setError]);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const userProfile: DiscordUser = await invoke('start_oauth_flow');
      setAuthenticated(userProfile);
    } catch (err: any) {
      console.error("Error during OAuth flow:", err);
      setUnauthenticated();
      setError(err.message || "An unknown error occurred during login.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col justify-center items-center">
      <h1 className="text-3xl font-bold mb-8">Discord Privacy Utility</h1>

      {isLoading && (
        <p className="text-xl text-yellow-500 mb-4">Loading...</p>
      )}

      {error && (
        <p className="text-xl text-red-500 mb-4">{error}</p>
      )}

      {!isAuthenticated && !isLoading ? (
        <button
          onClick={handleLogin}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300"
        >
          Login with Discord
        </button>
      ) : isAuthenticated ? (
        <div className="text-center">
          <p className="text-xl">Welcome, {user?.username}!</p>
          {user?.avatar && (
            <img
              src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`}
              alt="User Avatar"
              className="w-24 h-24 rounded-full mx-auto mt-4"
            />
          )}
          <button
            onClick={setUnauthenticated}
            className="mt-6 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300"
          >
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default App;
