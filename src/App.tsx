import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAuthStore } from './store/authStore';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { 
  Monitor, Smartphone, Key, Globe, ShieldCheck, ShieldAlert, 
  CheckCircle2, XCircle, HelpCircle, ArrowLeft, Info, 
  Trash2, Server, Hash, Clock
} from 'lucide-react';

interface DiscordUser {
  id: string;
  username: string;
  avatar?: string;
  email?: string;
}

interface DiscordStatus {
  is_running: boolean;
  rpc_available: boolean;
  browser_detected: boolean;
}

interface Guild {
  id: string;
  name: string;
  icon?: string;
}

interface Channel {
  id: string;
  name: string;
}

interface DeletionProgress {
  current_channel: number;
  total_channels: number;
  channel_id: string;
  deleted_count: number;
  status: 'fetching' | 'deleting';
}

const HelpMarker = ({ content }: { content: React.ReactNode }) => (
  <Tooltip.Provider delayDuration={100}>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button className="text-gray-600 hover:text-blue-500 transition-colors p-1" type="button">
          <HelpCircle className="w-4 h-4" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content 
          className="bg-gray-900 border border-gray-800 p-4 rounded-xl shadow-2xl max-w-xs text-sm text-gray-300 leading-relaxed z-[200] animate-in fade-in zoom-in-95"
          sideOffset={5}
        >
          {content}
          <Tooltip.Arrow className="fill-gray-900" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
);

function App() {
  const { 
    isAuthenticated, 
    needsCredentials, 
    user, 
    guilds, 
    isLoading, 
    error, 
    setAuthenticated, 
    setUnauthenticated, 
    setLoading, 
    setError, 
    setGuilds, 
    setNeedsCredentials 
  } = useAuthStore();
  
  const [selectedGuild, setSelectedGuild] = useState<Guild | null>(null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionProgress, setDeletionProgress] = useState<DeletionProgress | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | 'all'>('all');

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  const [authMethod, setAuthMethod] = useState<'none' | 'oauth' | 'qr' | 'token'>('none');
  const [discordStatus, setDiscordStatus] = useState<DiscordStatus | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrScanned, setQrScanned] = useState(false);
  const [manualToken, setManualToken] = useState('');

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

  const checkDiscordStatus = async () => {
    try {
      const status: DiscordStatus = await invoke('check_discord_status');
      setDiscordStatus(status);
    } catch (err) {
      console.error("Failed to check Discord status:", err);
    }
  };

  useEffect(() => {
    checkDiscordStatus();
    const interval = setInterval(checkDiscordStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unlistenStarted = listen('auth_started', () => {
      setLoading(true);
      setError(null);
    });

    const unlistenSuccess = listen('auth_success', (event) => {
      const userProfile = event.payload as DiscordUser;
      setAuthenticated(userProfile);
      setAuthMethod('none');
      setQrUrl(null);
      setQrScanned(false);
      fetchGuilds();
    });

    const unlistenQrReady = listen<string>('qr_code_ready', (event) => {
      setQrUrl(event.payload);
      setLoading(false);
    });

    const unlistenQrScanned = listen('qr_scanned', () => {
      setQrScanned(true);
    });

    const unlistenQrCancelled = listen('qr_cancelled', () => {
      setAuthMethod('none');
      setQrUrl(null);
      setQrScanned(false);
      setError("QR Login timed out or was cancelled.");
    });

    const unlistenProgress = listen('deletion_progress', (event) => {
      setDeletionProgress(event.payload as DeletionProgress);
    });

    const unlistenComplete = listen('deletion_complete', () => {
      setIsDeleting(false);
      setDeletionProgress(null);
    });

    return () => {
      unlistenStarted.then(f => f());
      unlistenSuccess.then(f => f());
      unlistenQrReady.then(f => f());
      unlistenQrScanned.then(f => f());
      unlistenQrCancelled.then(f => f());
      unlistenProgress.then(f => f());
      unlistenComplete.then(f => f());
    };
  }, [setAuthenticated, setLoading, setError, setGuilds]);

  const handleLoginOAuth = async () => {
    setLoading(true);
    setError(null);
    try {
      await invoke('start_oauth_flow');
    } catch (err: any) {
      if (err.error_code === 'credentials_missing') {
        setNeedsCredentials(true);
      } else {
        setError(err.message || "An unknown error occurred during login.");
      }
      setLoading(false);
    }
  };

  const handleLoginQR = async () => {
    setAuthMethod('qr');
    setLoading(true);
    setError(null);
    try {
      await invoke('start_qr_login_flow');
    } catch (err: any) {
      setError(err.message || "Failed to initialize QR login.");
      setLoading(false);
      setAuthMethod('none');
    }
  };

  const handleLoginToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await invoke('login_with_token', { token: manualToken });
    } catch (err: any) {
      setError(err.message || "Failed to login with token.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await invoke('save_discord_credentials', { clientId, clientSecret });
      setNeedsCredentials(false);
      handleLoginOAuth();
    } catch (err: any) {
      setError(err.message || "Failed to save credentials.");
      setLoading(false);
    }
  };

  const handleSelectGuild = async (guild: Guild) => {
    setSelectedGuild(guild);
    setChannels(null);
    setSelectedChannels(new Set());
    try {
      setLoading(true);
      const fetchedChannels: Channel[] = await invoke('fetch_channels', { guildId: guild.id });
      setChannels(fetchedChannels);
    } catch (err: any) {
      console.error("Error fetching channels:", err);
      setError(err.message || "Failed to fetch channels.");
    } finally {
      setLoading(false);
    }
  };

  const toggleChannel = (channelId: string) => {
    const next = new Set(selectedChannels);
    if (next.has(channelId)) {
      next.delete(channelId);
    } else {
      next.add(channelId);
    }
    setSelectedChannels(next);
  };

  const startDeletion = async () => {
    if (confirmText !== 'DELETE') return;
    
    setShowConfirmModal(false);
    setIsDeleting(true);
    setDeletionProgress(null);
    
    const now = Date.now();
    let startTime: number | undefined;
    if (timeRange === '24h') startTime = now - 24 * 60 * 60 * 1000;
    else if (timeRange === '7d') startTime = now - 7 * 24 * 60 * 60 * 1000;

    try {
      await invoke('bulk_delete_messages', {
        channelIds: Array.from(selectedChannels),
        startTime,
        endTime: undefined
      });
    } catch (err: any) {
      console.error("Error during deletion:", err);
      setError(err.message || "An error occurred during deletion.");
      setIsDeleting(false);
    }
  };

  const renderLoginScreen = () => {
    if (authMethod === 'qr') {
      return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center">
          <button 
            onClick={() => { setAuthMethod('none'); setQrUrl(null); setQrScanned(false); }}
            className="flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-white transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Login Options
          </button>
          
          <div className="bg-gray-900 border border-gray-800 p-10 rounded-[3rem] shadow-2xl text-center max-w-sm">
            <h3 className="text-2xl font-black mb-6">QR Login</h3>
            <div className="bg-white p-6 rounded-[2rem] inline-block shadow-2xl mb-6">
              {qrUrl ? (
                <QRCodeSVG value={qrUrl} size={200} level="H" includeMargin={true} />
              ) : (
                <div className="w-[200px] h-[200px] flex items-center justify-center bg-gray-50">
                  <div className="w-10 h-10 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                </div>
              )}
            </div>
            <p className="text-sm text-gray-400 leading-relaxed px-4">
              {qrScanned ? (
                <span className="text-green-400 font-bold flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Scan detected. Confirm on mobile.
                </span>
              ) : (
                "Open the Discord app on your phone and scan this code to login instantly."
              )}
            </p>
          </div>
        </motion.div>
      );
    }

    if (authMethod === 'token') {
      return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <button 
            onClick={() => setAuthMethod('none')}
            className="flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-white transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Login Options
          </button>

          <div className="bg-gray-900 border border-gray-800 p-10 rounded-[3rem] shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-black">Advanced Token</h3>
              <HelpMarker content={
                <div className="space-y-3">
                  <p className="font-bold text-red-400">⚠️ SECURITY WARNING</p>
                  <p>Your token gives full access to your account. Never share it.</p>
                  <hr className="border-gray-800" />
                  <p className="font-bold">How to find your token:</p>
                  <ol className="list-decimal list-inside space-y-1 text-xs">
                    <li>Open Discord in your browser</li>
                    <li>Press <code className="bg-black p-0.5 rounded text-blue-400">F12</code></li>
                    <li>Go to <span className="text-blue-400 font-bold">Network</span> tab</li>
                    <li>Filter by <code className="bg-black p-0.5 rounded">/api</code></li>
                    <li>Select any entry and find <span className="text-blue-400 font-bold">authorization</span> header</li>
                  </ol>
                </div>
              } />
            </div>
            
            <form onSubmit={handleLoginToken} className="space-y-6">
              <div className="space-y-2">
                <p className="text-xs text-gray-500 px-2 italic">Paste your user authorization token below.</p>
                <input
                  type="password"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="Paste token here..."
                  className="w-full bg-black border border-gray-800 p-4 rounded-2xl focus:outline-none focus:border-red-500/50 transition-all font-mono text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={!manualToken}
                className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${manualToken ? 'bg-red-600 hover:bg-red-700 text-white shadow-xl shadow-red-500/20' : 'bg-gray-800 text-gray-600 cursor-not-allowed'}`}
              >
                Connect with Token
              </button>
            </form>
          </div>
        </motion.div>
      );
    }

    return (
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8 px-4">
        {/* Environment & Quick Auth */}
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
          <div className="bg-gray-900/50 border border-gray-800 p-8 rounded-[2.5rem] backdrop-blur-3xl shadow-xl">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-sm font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">
                <Monitor className="w-4 h-4" /> Discord Environment
              </h3>
              <HelpMarker content="We detect active Discord sessions to offer faster connection methods." />
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-5 bg-black/40 rounded-2xl border border-white/5">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${discordStatus?.is_running ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-gray-700'}`} />
                  <span className="text-sm font-bold text-gray-400">Desktop Client</span>
                </div>
                <span className={`text-[10px] font-black uppercase tracking-widest ${discordStatus?.is_running ? 'text-green-500' : 'text-gray-600'}`}>
                  {discordStatus?.is_running ? 'Active' : 'Offline'}
                </span>
              </div>

              <div className="group relative">
                <button 
                  disabled={true} // Feature pending backend refactor
                  className="w-full flex items-center justify-between p-5 bg-black/40 rounded-2xl border border-white/5 opacity-50 cursor-not-allowed"
                >
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="w-4 h-4 text-gray-600" />
                    <span className="text-sm font-bold text-gray-400">Instant Link (RPC)</span>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-600">Pending</span>
                </button>
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[10px] font-bold px-3 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                  Coming Soon
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-900/50 border border-gray-800 p-10 rounded-[2.5rem] backdrop-blur-3xl shadow-xl text-center group hover:border-blue-500/30 transition-all">
            <Smartphone className="w-12 h-12 text-gray-700 mx-auto mb-6 group-hover:text-blue-500 transition-colors" />
            <h3 className="text-2xl font-black mb-2 tracking-tight">QR Login</h3>
            <p className="text-gray-500 text-sm mb-8">Scan with mobile app</p>
            <button 
              onClick={handleLoginQR}
              className="bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white border border-blue-500/20 font-black py-4 px-10 rounded-2xl text-xs uppercase tracking-widest transition-all w-full shadow-lg hover:shadow-blue-500/20"
            >
              Start QR Flow
            </button>
          </div>
        </motion.div>

        {/* Official & Manual Auth */}
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
          <div className="bg-gradient-to-br from-blue-600 to-indigo-800 p-12 rounded-[3rem] shadow-2xl shadow-blue-500/20 border border-white/10 relative overflow-hidden">
            <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
            <div className="flex items-center justify-between mb-6 relative z-10">
              <h3 className="text-3xl font-black tracking-tighter">Official Gate</h3>
              <HelpMarker content="Uses standard Discord OAuth2. Safe, secure, and redirects to the official website." />
            </div>
            <p className="text-blue-100/60 text-sm mb-10 leading-relaxed font-medium relative z-10">
              Connect your account through the official Discord authorization page. Recommended for all users.
            </p>
            <button
              onClick={handleLoginOAuth}
              className="w-full bg-white text-blue-700 font-black py-5 rounded-[1.5rem] shadow-2xl hover:scale-[1.02] active:scale-95 transition-all text-sm uppercase tracking-[0.2em] flex items-center justify-center gap-3 relative z-10"
            >
              <Globe className="w-5 h-5" /> Authorize Login
            </button>
          </div>

          <button 
            onClick={() => setAuthMethod('token')}
            className="w-full bg-gray-900/50 border border-gray-800 p-8 rounded-[2.5rem] flex items-center justify-between hover:border-red-500/30 transition-all text-left"
          >
            <div>
              <h3 className="text-sm font-black text-gray-500 uppercase tracking-[0.2em] mb-1">Manual Access</h3>
              <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">Connect with User Token</p>
            </div>
            <div className="bg-red-500/10 p-3 rounded-2xl">
              <Key className="w-5 h-5 text-red-500" />
            </div>
          </button>
        </motion.div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center py-12 px-4 selection:bg-blue-500/30">
      <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-center mb-16">
        <h1 className="text-6xl font-black tracking-tighter bg-gradient-to-br from-white via-gray-200 to-gray-600 bg-clip-text text-transparent mb-3">
          DISCORD PURGE
        </h1>
        <div className="flex items-center justify-center gap-3">
          <div className="h-px w-8 bg-gray-800" />
          <p className="text-gray-600 font-black text-[10px] uppercase tracking-[0.5em]">Privacy Enforcement Unit</p>
          <div className="h-px w-8 bg-gray-800" />
        </div>
      </motion.div>

      <AnimatePresence>
        {isLoading && !isDeleting && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="fixed bottom-8 bg-blue-600 px-6 py-3 rounded-full shadow-2xl z-50 flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            <p className="font-black text-[10px] uppercase tracking-widest">Initializing Protocol...</p>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-red-950/20 border border-red-500/30 text-red-200 p-6 mb-12 w-full max-w-2xl rounded-3xl backdrop-blur-xl flex items-center gap-5 shadow-2xl shadow-red-500/5">
          <ShieldAlert className="w-8 h-8 text-red-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-500 mb-1">System Error</p>
            <p className="text-sm font-bold opacity-90 leading-relaxed">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="hover:text-white transition-colors">
            <XCircle className="w-6 h-6 opacity-30 hover:opacity-100" />
          </button>
        </motion.div>
      )}

      {needsCredentials ? (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-gray-900/50 border border-gray-800 p-12 rounded-[3.5rem] shadow-2xl max-w-lg w-full backdrop-blur-3xl">
          <div className="text-center mb-10">
            <div className="w-20 h-20 bg-blue-600/10 rounded-[2rem] flex items-center justify-center mx-auto mb-6 border border-blue-500/20 shadow-2xl">
              <Key className="w-10 h-10 text-blue-500" />
            </div>
            <h2 className="text-4xl font-black tracking-tighter mb-3">API CONFIG</h2>
            <p className="text-gray-500 text-sm font-medium">Link your Discord Developer application to enable secure OAuth2 features.</p>
          </div>
          
          <form onSubmit={handleSaveCredentials} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] ml-3 flex items-center gap-2">
                Client ID <HelpMarker content="The 18-19 digit ID of your Discord Application." />
              </label>
              <input type="text" required value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Application ID" className="w-full bg-black/40 border border-gray-800 p-5 rounded-2xl focus:outline-none focus:border-blue-500/50 transition-all font-mono text-sm" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-600 uppercase tracking-[0.2em] ml-3 flex items-center gap-2">
                Client Secret <HelpMarker content="The highly sensitive token for your Discord Application. Never share this." />
              </label>
              <input type="password" required value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="••••••••••••••••" className="w-full bg-black/40 border border-gray-800 p-5 rounded-2xl focus:outline-none focus:border-blue-500/50 transition-all font-mono text-sm" />
            </div>
            <button type="submit" className="w-full bg-white text-black font-black py-6 rounded-3xl shadow-2xl hover:bg-gray-100 transition-all active:scale-95 text-xs uppercase tracking-[0.2em]">
              Save Configuration
            </button>
            <div className="flex items-center gap-3 justify-center mt-8 p-5 bg-gray-900/50 rounded-2xl border border-gray-800">
              <Info className="w-4 h-4 text-blue-500" />
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest leading-relaxed">
                Found in <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-400 underline decoration-2 underline-offset-4 transition-all">Developer Portal</a>
              </p>
            </div>
          </form>
        </motion.div>
      ) : !isAuthenticated && !isLoading ? (
        renderLoginScreen()
      ) : isAuthenticated ? (
        <div className="w-full max-w-6xl space-y-10">
          {/* Header & Profile */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between bg-gray-900/40 border border-gray-800 p-8 rounded-[3rem] backdrop-blur-md shadow-2xl">
            <div className="flex items-center gap-6">
              {user?.avatar ? (
                <img src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`} alt="User Avatar" className="w-20 h-20 rounded-[1.5rem] border-2 border-blue-500/20 shadow-2xl" />
              ) : (
                <div className="w-20 h-20 rounded-[1.5rem] bg-blue-600/10 border border-blue-500/20 flex items-center justify-center font-black text-3xl text-blue-500">
                  {user?.username.charAt(0)}
                </div>
              )}
              <div>
                <h2 className="text-3xl font-black tracking-tighter">{user?.username}</h2>
                <div className="flex items-center gap-3 mt-2">
                  <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
                  <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.3em]">Authorized Session</p>
                </div>
              </div>
            </div>
            <button onClick={setUnauthenticated} className="text-gray-500 hover:text-red-500 transition-all text-[10px] font-black uppercase tracking-[0.3em] px-10 py-4 hover:bg-red-500/5 rounded-2xl border border-gray-800 hover:border-red-500/20">
              Terminate
            </button>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            {/* Guild List */}
            <div className="lg:col-span-4 space-y-6">
              <div className="flex items-center justify-between px-4">
                <h3 className="text-[10px] font-black text-gray-600 uppercase tracking-[0.4em] flex items-center gap-2">
                  <Server className="w-3 h-3" /> Data Sources
                </h3>
                <span className="bg-gray-900 text-gray-500 text-[10px] font-black px-3 py-1 rounded-full border border-gray-800">{guilds?.length || 0}</span>
              </div>
              <div className="bg-gray-900/40 border border-gray-800 rounded-[3rem] overflow-hidden max-h-[600px] overflow-y-auto custom-scrollbar p-3 space-y-2 shadow-inner">
                {guilds?.map((guild) => (
                  <button
                    key={guild.id}
                    onClick={() => handleSelectGuild(guild)}
                    className={`w-full flex items-center gap-5 p-5 rounded-[2rem] transition-all relative overflow-hidden group ${selectedGuild?.id === guild.id ? 'bg-blue-600 text-white shadow-2xl' : 'hover:bg-white/5 text-gray-400'}`}
                  >
                    {guild.icon ? (
                      <img src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`} alt={guild.name} className="w-12 h-12 rounded-2xl shadow-xl transition-transform group-hover:scale-110" />
                    ) : (
                      <div className="w-12 h-12 rounded-2xl bg-gray-800 flex items-center justify-center font-black text-lg text-gray-500">
                        {guild.name.charAt(0)}
                      </div>
                    )}
                    <span className="font-black text-sm tracking-tight truncate">{guild.name}</span>
                    {selectedGuild?.id === guild.id && <div className="absolute right-6 w-2 h-2 bg-white rounded-full shadow-[0_0_10px_white]" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Channels & Actions */}
            <div className="lg:col-span-8 space-y-8">
              {selectedGuild ? (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                  <div className="bg-gray-900/40 border border-gray-800 p-12 rounded-[3.5rem] backdrop-blur-3xl space-y-10 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-8">
                      <Trash2 className="w-20 h-20 text-red-500/5 rotate-12" />
                    </div>
                    
                    <div className="relative z-10">
                      <h3 className="text-4xl font-black text-white tracking-tighter mb-2">{selectedGuild.name}</h3>
                      {channels && <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.3em]">Mapping {channels.length} specific buffers</p>}
                    </div>

                    {/* Time Range */}
                    <div className="space-y-5 relative z-10">
                      <div className="flex items-center gap-2">
                        <Clock className="w-3 h-3 text-gray-600" />
                        <label className="text-[10px] font-black text-gray-600 uppercase tracking-[0.3em]">Temporal scope</label>
                      </div>
                      <div className="flex gap-3 p-2 bg-black/40 rounded-[1.5rem] border border-gray-800 shadow-inner">
                        {(['24h', '7d', 'all'] as const).map((r) => (
                          <button
                            key={r}
                            onClick={() => setTimeRange(r)}
                            className={`flex-1 py-4 rounded-[1.2rem] font-black text-[10px] uppercase tracking-widest transition-all ${timeRange === r ? 'bg-white text-black shadow-2xl scale-[1.02]' : 'text-gray-500 hover:text-gray-300'}`}
                          >
                            {r === '24h' ? '24 Hours' : r === '7d' ? '7 Days' : 'Eternal'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Channel List */}
                    <div className="space-y-5 relative z-10">
                      <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-2">
                          <Hash className="w-3 h-3 text-gray-600" />
                          <label className="text-[10px] font-black text-gray-600 uppercase tracking-[0.3em]">Target Selection</label>
                        </div>
                        <button 
                          onClick={() => setSelectedChannels(new Set(channels?.map(c => c.id)))}
                          className="text-[10px] font-black text-blue-500 hover:text-blue-400 uppercase tracking-widest underline decoration-2 underline-offset-4"
                        >
                          Select All
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[350px] overflow-y-auto pr-3 custom-scrollbar p-1">
                        {channels?.map((channel) => (
                          <button
                            key={channel.id}
                            onClick={() => toggleChannel(channel.id)}
                            className={`flex items-center justify-between p-5 rounded-[1.5rem] border-2 transition-all text-left group ${selectedChannels.has(channel.id) ? 'bg-blue-600/10 border-blue-500 shadow-xl text-blue-100' : 'bg-black/20 border-gray-800 text-gray-500 hover:border-gray-700'}`}
                          >
                            <span className="truncate font-black text-xs tracking-tight">#{channel.name}</span>
                            <div className={`w-5 h-5 rounded-lg flex items-center justify-center border-2 transition-all ${selectedChannels.has(channel.id) ? 'bg-blue-500 border-blue-500 scale-110' : 'border-gray-800'}`}>
                              {selectedChannels.has(channel.id) && <span className="text-[10px] font-black text-white">✓</span>}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="pt-10 relative z-10">
                      <button
                        disabled={selectedChannels.size === 0 || isDeleting}
                        onClick={() => setShowConfirmModal(true)}
                        className={`w-full py-7 rounded-[2rem] font-black text-sm uppercase tracking-[0.3em] shadow-2xl transition-all ${selectedChannels.size > 0 && !isDeleting ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-500/20 hover:scale-[1.01]' : 'bg-gray-800 text-gray-700 cursor-not-allowed'}`}
                      >
                        {isDeleting ? 'Executing Purge...' : `Initialize Purge (${selectedChannels.size})`}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="h-full min-h-[500px] flex flex-col items-center justify-center bg-gray-900/20 border-2 border-gray-800 border-dashed rounded-[4rem] p-20 text-center relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5" />
                  <div className="w-24 h-24 bg-gray-900/50 rounded-full flex items-center justify-center mb-8 border-2 border-gray-800 shadow-2xl relative z-10">
                    <ShieldCheck className="w-12 h-12 text-gray-800" />
                  </div>
                  <h3 className="text-2xl font-black tracking-tight text-gray-600 mb-3 relative z-10">Ready for Scan</h3>
                  <p className="text-gray-700 text-xs font-bold uppercase tracking-[0.2em] max-w-[250px] leading-relaxed relative z-10">Select a data source to begin mapping buffers for deletion.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-[50vh] space-y-6">
           <div className="w-16 h-16 border-4 border-blue-500/10 border-t-blue-500 rounded-full animate-spin shadow-2xl" />
           <p className="text-gray-600 text-[10px] font-black uppercase tracking-[0.5em] animate-pulse">Warming Up Systems...</p>
        </div>
      )}

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirmModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/95 backdrop-blur-2xl z-[150] flex items-center justify-center p-6">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-gray-900 border border-red-500/30 rounded-[4rem] p-16 w-full max-w-xl shadow-2xl space-y-10 relative overflow-hidden">
              <div className="absolute -top-20 -left-20 w-60 h-60 bg-red-600/5 rounded-full blur-3xl" />
              <div className="text-center space-y-6 relative z-10">
                <div className="w-24 h-24 bg-red-600/10 text-red-600 rounded-[2.5rem] flex items-center justify-center mx-auto mb-8 border-2 border-red-500/20 shadow-2xl shadow-red-500/10">
                  <ShieldAlert className="w-12 h-12" />
                </div>
                <h2 className="text-5xl font-black tracking-tighter">FINAL VERIFICATION</h2>
                <div className="space-y-2 text-gray-400 font-bold text-sm uppercase tracking-widest">
                  <p>Initializing purge sequence for</p>
                  <p className="text-white text-lg font-black">{selectedChannels.size} target channels</p>
                  <p>in <span className="text-white font-black">{selectedGuild?.name}</span></p>
                </div>
                <div className="bg-red-600/10 p-5 rounded-2xl border border-red-500/20 inline-block mt-6">
                  <p className="text-[10px] text-red-500 font-black uppercase tracking-[0.4em]">Destructive Action Protocol: ACTIVE</p>
                </div>
              </div>

              <div className="space-y-4 relative z-10">
                <label className="text-[10px] font-black text-gray-600 uppercase tracking-[0.3em] ml-4">Authorized Signature Required (<span className="text-red-500 underline">DELETE</span>)</label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="AUTHORIZE"
                  className="w-full bg-black/60 border border-gray-800 p-6 rounded-[2rem] text-center font-black tracking-[0.5em] text-red-500 focus:outline-none focus:border-red-500/50 transition-all uppercase text-lg shadow-inner"
                />
              </div>

              <div className="flex gap-6 relative z-10">
                <button onClick={() => setShowConfirmModal(false)} className="flex-1 py-6 text-gray-500 font-black uppercase tracking-[0.3em] text-xs hover:text-white transition-all border border-gray-800 rounded-[1.5rem] hover:bg-white/5">
                  Abort
                </button>
                <button
                  disabled={confirmText !== 'DELETE'}
                  onClick={startDeletion}
                  className={`flex-1 py-6 rounded-[1.5rem] font-black text-xs uppercase tracking-[0.3em] transition-all shadow-2xl ${confirmText === 'DELETE' ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-500/20 scale-105' : 'bg-gray-800 text-gray-700 cursor-not-allowed'}`}
                >
                  Confirm Purge
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Progress Overlay */}
      <AnimatePresence>
        {isDeleting && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 bg-gray-950/99 backdrop-blur-[100px] z-[200] flex flex-col items-center justify-center p-10 text-center">
            <div className="w-full max-w-3xl space-y-20 relative">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] -z-10 animate-pulse" />
              
              <div className="space-y-6">
                <motion.div animate={{ scale: [1, 1.02, 1], opacity: [0.8, 1, 0.8] }} transition={{ duration: 1.5, repeat: Infinity }} className="text-8xl font-black tracking-tighter italic">
                  PURGING...
                </motion.div>
                <div className="flex items-center justify-center gap-4">
                  <div className="w-3 h-3 bg-red-500 rounded-full animate-ping shadow-[0_0_15px_red]" />
                  <p className="text-red-500 font-black text-[10px] uppercase tracking-[0.6em]">Protocol Enforcement Active</p>
                </div>
              </div>

              <div className="space-y-16">
                {deletionProgress ? (
                  <>
                    <div className="space-y-6">
                      <div className="flex justify-between text-[10px] font-black text-gray-500 px-6 uppercase tracking-[0.4em]">
                        <span>System Saturation</span>
                        <span className="text-blue-500">Target {deletionProgress.current_channel} / {deletionProgress.total_channels}</span>
                      </div>
                      <div className="w-full h-4 bg-gray-900/50 rounded-full overflow-hidden border border-white/5 p-1 backdrop-blur-3xl shadow-inner">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${(deletionProgress.current_channel / deletionProgress.total_channels) * 100}%` }}
                          className="h-full bg-gradient-to-r from-blue-600 via-purple-600 to-red-600 rounded-full shadow-[0_0_30px_rgba(59,130,246,0.4)]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-12">
                      <div className="bg-black/40 p-10 rounded-[3rem] border border-white/5 shadow-2xl backdrop-blur-2xl">
                        <p className="text-[10px] font-black text-gray-600 uppercase tracking-[0.4em] mb-3">Status</p>
                        <p className="text-3xl font-black text-blue-500 uppercase tracking-tighter italic">{deletionProgress.status}</p>
                      </div>
                      <div className="bg-black/40 p-10 rounded-[3rem] border border-white/5 shadow-2xl backdrop-blur-2xl">
                        <p className="text-[10px] font-black text-gray-600 uppercase tracking-[0.4em] mb-3">Nullified</p>
                        <p className="text-3xl font-black text-red-500 tracking-tighter italic">{deletionProgress.deleted_count}</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                       <p className="text-gray-600 text-[10px] font-black uppercase tracking-[0.4em]">Active Buffer</p>
                       <p className="text-white font-mono text-lg font-bold tracking-tight bg-white/5 px-6 py-2 rounded-xl inline-block border border-white/10">
                        #{channels?.find(c => c.id === deletionProgress.channel_id)?.name || '0xUNKNOWN'}
                       </p>
                    </div>
                  </>
                ) : (
                  <div className="space-y-10">
                    <div className="w-24 h-24 border-4 border-blue-500/10 border-t-blue-500 rounded-[2rem] animate-spin mx-auto shadow-[0_0_50px_rgba(59,130,246,0.2)]" />
                    <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.4em] animate-pulse">Syncing with Discord Mainframe...</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
