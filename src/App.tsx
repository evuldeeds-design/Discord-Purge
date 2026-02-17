import React, { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { useAuthStore } from './store/authStore';

interface DiscordUser {
  id: string;
  username: string;
  avatar?: string;
  email?: string;
}

function App() {
  const { isAuthenticated, user, setAuthenticated, setUnauthenticated } = useAuthStore();

  useEffect(() => {
    // Listen for the auth_success event from the Rust backend
    const unlisten = listen('auth_success', (event) => {
      const userProfile = event.payload as DiscordUser;
      setAuthenticated(userProfile);
    });

    // Cleanup the event listener when the component unmounts
    return () => {
      unlisten.then(f => f());
    };
  }, [setAuthenticated]);

  const handleLogin = async () => {
    try {
      const userProfile: DiscordUser = await invoke('start_oauth_flow');
      setAuthenticated(userProfile);
    } catch (error) {
      console.error("Error during OAuth flow:", error);
      setUnauthenticated();
      // Optionally show an error message to the user
    }
  };

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col justify-center items-center">
      <h1 className="text-3xl font-bold mb-8">Discord Privacy Utility</h1>

      {!isAuthenticated ? (
        <button
          onClick={handleLogin}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300"
        >
          Login with Discord
        </button>
      ) : (
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
      )}
    </div>
  );
}

export default App;
