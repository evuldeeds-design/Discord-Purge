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

interface Guild {
  id: string;
  name: string;
  icon?: string;
}

function App() {
  const { isAuthenticated, user, guilds, isLoading, error, setAuthenticated, setUnauthenticated, setLoading, setError, setGuilds } = useAuthStore();

  const fetchGuilds = async () => {
    try {
      setLoading(true);
      const fetchedGuilds: Guild[] = await invoke('fetch_guilds');
      setGuilds(fetchedGuilds);
    } catch (err: any) {
      console.error("Error fetching guilds:", err);
      setError(err.message || "Failed to fetch guilds.");
    } finally {
      setLoading(false);
    }
  };

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
      fetchGuilds();
    });

    // Cleanup the event listeners when the component unmounts
    return () => {
      unlistenStarted.then(f => f());
      unlistenSuccess.then(f => f());
    };
  }, [setAuthenticated, setLoading, setError, setGuilds]);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const userProfile: DiscordUser = await invoke('start_oauth_flow');
      setAuthenticated(userProfile);
      await fetchGuilds();
    } catch (err: any) {
      console.error("Error during OAuth flow:", err);
      setUnauthenticated();
      setError(err.message || "An unknown error occurred during login.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center py-12">
      <h1 className="text-4xl font-bold mb-8">Discord Privacy Utility</h1>

      {isLoading && (
        <div className="fixed top-4 right-4 bg-yellow-600 px-4 py-2 rounded-lg shadow-lg">
          <p className="font-semibold">Loading...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-900 border-l-4 border-red-500 text-red-100 p-4 mb-8 w-full max-w-2xl">
          <p className="font-bold">Error</p>
          <p>{error}</p>
        </div>
      )}

      {!isAuthenticated && !isLoading ? (
        <div className="flex flex-col items-center">
          <p className="text-gray-400 mb-8 max-w-md text-center">
            Log in with your Discord account to securely manage your messages and server memberships.
          </p>
          <button
            onClick={handleLogin}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-xl shadow-xl transition-all hover:scale-105 active:scale-95"
          >
            Login with Discord
          </button>
        </div>
      ) : isAuthenticated ? (
        <div className="w-full max-w-4xl px-4">
          <div className="flex items-center justify-between bg-gray-800 p-6 rounded-2xl shadow-lg mb-8">
            <div className="flex items-center gap-4">
              {user?.avatar && (
                <img
                  src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`}
                  alt="User Avatar"
                  className="w-16 h-16 rounded-full border-2 border-blue-500"
                />
              )}
              <div>
                <h2 className="text-2xl font-semibold">{user?.username}</h2>
                <p className="text-gray-400 text-sm">Authenticated via Discord</p>
              </div>
            </div>
            <button
              onClick={setUnauthenticated}
              className="bg-red-900/50 hover:bg-red-800 text-red-100 border border-red-500/50 font-semibold py-2 px-6 rounded-lg transition-colors"
            >
              Logout
            </button>
          </div>

          {guilds && (
            <div className="bg-gray-800 p-8 rounded-2xl shadow-lg">
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                Your Servers
                <span className="bg-blue-600 text-xs px-2 py-1 rounded-full">{guilds.length}</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                {guilds.map((guild) => (
                  <div key={guild.id} className="flex items-center gap-3 bg-gray-700/50 p-4 rounded-xl hover:bg-gray-700 transition-colors border border-gray-600">
                    {guild.icon ? (
                      <img
                        src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`}
                        alt={guild.name}
                        className="w-12 h-12 rounded-xl shadow-inner"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-gray-600 flex items-center justify-center font-bold text-lg text-gray-400">
                        {guild.name.charAt(0)}
                      </div>
                    )}
                    <span className="font-medium truncate">{guild.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default App;
