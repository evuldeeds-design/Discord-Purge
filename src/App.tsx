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

// ... (Keep existing interfaces for DiscordUser, DiscordStatus, Guild, Channel, DeletionProgress)
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
  status: string;
}

const HelpMarker = ({ content }: { content: React.ReactNode }) => (
  <Tooltip.Provider delayDuration={100}>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button className="text-gray-500 hover:text-blue-400 transition-colors p-1" type="button">
          <HelpCircle className="w-4 h-4" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content 
          className="bg-gray-900 border border-gray-800 p-4 rounded-lg shadow-2xl max-w-xs text-sm text-gray-300 z-[200] animate-in fade-in"
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
    isAuthenticated, needsCredentials, user, guilds, isLoading, error, 
    setAuthenticated, setUnauthenticated, setLoading, setError, setGuilds, setNeedsCredentials 
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

  const [authMethod, setAuthMethod] = useState<'none' | 'oauth' | 'qr' | 'token' | 'rpc'>('none');
  const [discordStatus, setDiscordStatus] = useState<DiscordStatus | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrScanned, setQrScanned] = useState(false);
  const [manualToken, setManualToken] = useState('');

  // ... (Keep existing fetchGuilds, checkDiscordStatus, useEffect hooks)
  const fetchGuilds = async () => {
    try {
      setLoading(true);
      const fetchedGuilds: Guild[] = await invoke('fetch_guilds');
      setGuilds(fetchedGuilds);
    } catch (err: any) {
      setError(err.message || "Failed to fetch guilds.");
    } finally {
      setLoading(false);
    }
  };

  const checkDiscordStatus = async () => {
    try {
      const status: DiscordStatus = await invoke('check_discord_status');
      setDiscordStatus(status);
    } catch (err) {}
  };

  useEffect(() => {
    checkDiscordStatus();
    const interval = setInterval(checkDiscordStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [
      listen('auth_started', () => { setLoading(true); setError(null); }),
      listen('auth_success', (event) => {
        setAuthenticated(event.payload as DiscordUser);
        setAuthMethod('none');
        setQrUrl(null);
        setQrScanned(false);
        fetchGuilds();
      }),
      listen<string>('qr_code_ready', (event) => { setQrUrl(event.payload); setLoading(false); }),
      listen('qr_scanned', () => setQrScanned(true)),
      listen('qr_cancelled', () => {
        setAuthMethod('none'); setQrUrl(null); setQrScanned(false);
        setError("QR Login timed out or was cancelled.");
      }),
      listen('deletion_progress', (event) => setDeletionProgress(event.payload as DeletionProgress)),
      listen('deletion_complete', () => { setIsDeleting(false); setDeletionProgress(null); }),
    ];
    return () => {
      unlisteners.forEach(async (u) => (await u)());
    };
  }, []);

  const handleLoginOAuth = async () => {
    setLoading(true); setError(null);
    try {
      await invoke('start_oauth_flow');
    } catch (err: any) {
      if (err.error_code === 'credentials_missing') setNeedsCredentials(true);
      else setError(err.user_message || "OAuth login failed.");
      setLoading(false);
    }
  };

  const handleLoginQR = async () => {
    setAuthMethod('qr'); setLoading(true); setError(null);
    try {
      await invoke('start_qr_login_flow');
    } catch (err: any) {
      setError(err.user_message || "QR initialization failed.");
      setLoading(false); setAuthMethod('none');
    }
  };

  const handleLoginRPC = async () => {
    setAuthMethod('rpc'); setLoading(true); setError(null);
    try {
      await invoke('login_with_rpc');
    } catch (err: any) {
      setError(err.user_message || "Instant Link failed.");
      setAuthMethod('none'); setLoading(false);
    }
  };

  const handleLoginToken = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError(null);
    try {
      await invoke('login_with_user_token', { token: manualToken });
    } catch (err: any) {
      setError(err.user_message || "Token login failed.");
      setLoading(false);
    }
  };

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError(null);
    try {
      await invoke('save_discord_credentials', { clientId, clientSecret });
      setNeedsCredentials(false);
      // Wait a bit for keyring to sync
      setTimeout(() => handleLoginOAuth(), 500);
    } catch (err: any) {
      setError("Failed to save credentials.");
      setLoading(false);
    }
  };

  // ... (Keep existing handleSelectGuild, toggleChannel, startDeletion)
  const handleSelectGuild = async (guild: Guild) => {
    setSelectedGuild(guild); setChannels(null); setSelectedChannels(new Set());
    try {
      setLoading(true);
      const fetchedChannels: Channel[] = await invoke('fetch_channels', { guildId: guild.id });
      setChannels(fetchedChannels);
    } catch (err: any) {
      setError("Failed to fetch channels.");
    } finally {
      setLoading(false);
    }
  };

  const toggleChannel = (id: string) => {
    const next = new Set(selectedChannels);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedChannels(next);
  };

  const startDeletion = async () => {
    if (confirmText !== 'DELETE') return;
    setShowConfirmModal(false); setIsDeleting(true);
    const now = Date.now();
    let startTime: number | undefined;
    if (timeRange === '24h') startTime = now - 86400000;
    else if (timeRange === '7d') startTime = now - 604800000;
    try {
      await invoke('bulk_delete_messages', { channelIds: Array.from(selectedChannels), startTime, endTime: undefined });
    } catch (err: any) {
      setError(err.user_message || "Purge failed.");
      setIsDeleting(false);
    }
  };

  if (needsCredentials) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center gap-2 mb-6">
            <button onClick={() => setNeedsCredentials(false)} className="text-gray-500 hover:text-white"><ArrowLeft className="w-5 h-5" /></button>
            <h2 className="text-2xl font-bold">API Configuration</h2>
          </div>
          <form onSubmit={handleSaveCredentials} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Client ID</label>
              <input type="text" required value={clientId} onChange={e => setClientId(e.target.value)} className="w-full bg-black border border-gray-800 p-3 rounded-lg focus:border-blue-500 outline-none" placeholder="123456789..." />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Client Secret</label>
              <input type="password" required value={clientSecret} onChange={e => setClientSecret(e.target.value)} className="w-full bg-black border border-gray-800 p-3 rounded-lg focus:border-blue-500 outline-none" placeholder="••••••••" />
            </div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 py-3 rounded-lg font-bold transition-colors">Save & Authorize</button>
            <p className="text-[11px] text-gray-500 text-center">
              Found in the <a href="https://discord.com/developers/applications" target="_blank" className="text-blue-500 underline">Discord Developer Portal</a> under OAuth2 &gt; General.
            </p>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans p-8 selection:bg-blue-500/30">
      <header className="max-w-5xl mx-auto mb-12 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">DISCORD PURGE</h1>
          <p className="text-xs text-gray-500 font-mono tracking-widest uppercase mt-1">Privacy Enforcement Utility</p>
        </div>
        {isAuthenticated && (
          <div className="flex items-center gap-4 bg-gray-900 border border-gray-800 p-2 pr-4 rounded-full">
            {user?.avatar ? <img src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`} className="w-8 h-8 rounded-full" /> : <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center font-bold text-xs">{user?.username[0]}</div>}
            <span className="text-sm font-bold">{user?.username}</span>
            <button onClick={setUnauthenticated} className="text-gray-500 hover:text-red-500 ml-2"><XCircle className="w-4 h-4" /></button>
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto">
        <AnimatePresence mode="wait">
          {!isAuthenticated ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              {authMethod === 'none' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <section className="space-y-6">
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2"><Monitor className="w-4 h-4" /> Environment</h3>
                        <HelpMarker content="We detect your local Discord client to enable Instant Link login." />
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-black/40 rounded-xl border border-white/5">
                          <span className="text-sm">Desktop App</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${discordStatus?.is_running ? 'bg-green-500/10 text-green-500' : 'bg-gray-800 text-gray-500'}`}>{discordStatus?.is_running ? 'RUNNING' : 'OFFLINE'}</span>
                        </div>
                        <button 
                          onClick={handleLoginRPC}
                          disabled={!discordStatus?.rpc_available}
                          className={`w-full flex items-center justify-between p-3 bg-black/40 rounded-xl border transition-all ${discordStatus?.rpc_available ? 'border-blue-500/50 hover:bg-blue-500/5' : 'border-white/5 opacity-50'}`}
                        >
                          <span className="text-sm font-bold text-blue-400">Instant Link (RPC)</span>
                          <span className="text-[10px] font-black">{discordStatus?.rpc_available ? 'READY' : 'UNAVAILABLE'}</span>
                        </button>
                      </div>
                    </div>

                    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center group hover:border-blue-500/30 transition-colors">
                      <Smartphone className="w-10 h-10 text-gray-600 mx-auto mb-4 group-hover:text-blue-400" />
                      <h3 className="text-xl font-bold mb-2">QR Code</h3>
                      <p className="text-sm text-gray-500 mb-6">Safe login via mobile app</p>
                      <button onClick={handleLoginQR} className="w-full bg-blue-600/10 text-blue-400 border border-blue-500/20 py-3 rounded-xl font-bold hover:bg-blue-600 hover:text-white transition-all">Scan QR</button>
                    </div>
                  </section>

                  <section className="space-y-6">
                    <div className="bg-blue-600 rounded-2xl p-8 shadow-xl shadow-blue-900/20 relative overflow-hidden">
                      <Globe className="absolute -right-4 -bottom-4 w-24 h-24 text-white/5" />
                      <h3 className="text-2xl font-bold mb-2">Official Gate</h3>
                      <p className="text-blue-100/70 text-sm mb-8 leading-relaxed">The standard OAuth2 flow. Secure and easy for everyone.</p>
                      <button onClick={handleLoginOAuth} className="w-full bg-white text-blue-700 py-4 rounded-xl font-bold hover:scale-[1.02] active:scale-95 transition-all">Authorize with Discord</button>
                    </div>

                    <button onClick={() => setAuthMethod('token')} className="w-full bg-gray-900 border border-gray-800 p-6 rounded-2xl flex items-center justify-between hover:bg-gray-800 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="bg-red-500/10 p-2 rounded-lg text-red-500"><Key className="w-5 h-5" /></div>
                        <div className="text-left">
                          <h4 className="font-bold">Manual Token</h4>
                          <p className="text-xs text-gray-500">Advanced user bypass</p>
                        </div>
                      </div>
                      <HelpMarker content="For power users. Paste your account token directly. Use with caution." />
                    </button>
                  </section>
                </div>
              ) : authMethod === 'qr' ? (
                <div className="max-w-md mx-auto text-center bg-gray-900 border border-gray-800 p-10 rounded-3xl shadow-2xl">
                  <button onClick={() => setAuthMethod('none')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-white mb-8"><ArrowLeft className="w-4 h-4" /> Back</button>
                  <div className="bg-white p-4 rounded-2xl inline-block mb-6 shadow-xl">
                    {qrUrl ? <QRCodeSVG value={qrUrl} size={200} /> : <div className="w-[200px] h-[200px] flex items-center justify-center bg-gray-100"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}
                  </div>
                  <p className="text-sm text-gray-400">{qrScanned ? "✓ Scanned! Confirm on your phone." : "Scan this with your Discord mobile app."}</p>
                </div>
              ) : (
                <div className="max-w-md mx-auto bg-gray-900 border border-gray-800 p-10 rounded-3xl shadow-2xl">
                  <button onClick={() => setAuthMethod('none')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-white mb-8"><ArrowLeft className="w-4 h-4" /> Back</button>
                  <h3 className="text-xl font-bold mb-6 flex items-center gap-2">Token Entry <HelpMarker content="To find your token: F12 in browser > Network > Filter '/api' > Find 'authorization' header." /></h3>
                  <form onSubmit={handleLoginToken} className="space-y-6">
                    <input type="password" value={manualToken} onChange={e => setManualToken(e.target.value)} className="w-full bg-black border border-gray-800 p-4 rounded-xl focus:border-red-500 outline-none font-mono text-sm" placeholder="Paste user token..." />
                    <button type="submit" disabled={!manualToken} className="w-full bg-red-600 hover:bg-red-700 py-4 rounded-xl font-bold transition-all disabled:opacity-50">Connect Token</button>
                  </form>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <aside className="lg:col-span-4 space-y-4">
                <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-2 flex items-center gap-2"><Server className="w-3 h-3" /> Target Servers</h3>
                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl overflow-hidden max-h-[600px] overflow-y-auto custom-scrollbar p-2 space-y-1">
                  {guilds?.map(g => (
                    <button key={g.id} onClick={() => handleSelectGuild(g)} className={`w-full flex items-center gap-4 p-4 rounded-xl transition-all ${selectedGuild?.id === g.id ? 'bg-blue-600 text-white shadow-lg' : 'hover:bg-white/5 text-gray-400'}`}>
                      {g.icon ? <img src={`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`} className="w-10 h-10 rounded-lg" /> : <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center font-bold">{g.name[0]}</div>}
                      <span className="text-sm font-bold truncate">{g.name}</span>
                    </button>
                  ))}
                </div>
              </aside>

              <div className="lg:col-span-8">
                {selectedGuild ? (
                  <div className="bg-gray-900 border border-gray-800 rounded-3xl p-10 space-y-8 shadow-2xl">
                    <h3 className="text-3xl font-bold text-white">{selectedGuild.name}</h3>
                    
                    <div className="space-y-4">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-2"><Clock className="w-3 h-3" /> Time Range</label>
                      <div className="flex gap-2 p-1 bg-black rounded-xl border border-gray-800">
                        {(['24h', '7d', 'all'] as const).map(r => (
                          <button key={r} onClick={() => setTimeRange(r)} className={`flex-1 py-3 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${timeRange === r ? 'bg-white text-black' : 'text-gray-500 hover:text-gray-300'}`}>{r === '24h' ? '24H' : r === '7d' ? '7D' : 'All Time'}</button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-2"><Hash className="w-3 h-3" /> Channels</label>
                        <button onClick={() => setSelectedChannels(new Set(channels?.map(c => c.id)))} className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Select All</button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto custom-scrollbar">
                        {channels?.map(c => (
                          <button key={c.id} onClick={() => toggleChannel(c.id)} className={`flex items-center justify-between p-4 rounded-xl border transition-all ${selectedChannels.has(c.id) ? 'bg-blue-600/10 border-blue-500 text-blue-100' : 'bg-black border-gray-800 text-gray-500'}`}>
                            <span className="text-xs font-bold">#{c.name}</span>
                            <div className={`w-4 h-4 rounded-md border flex items-center justify-center ${selectedChannels.has(c.id) ? 'bg-blue-500 border-blue-500' : 'border-gray-700'}`}>{selectedChannels.has(c.id) && <CheckCircle2 className="w-3 h-3 text-white" />}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <button disabled={selectedChannels.size === 0 || isDeleting} onClick={() => setShowConfirmModal(true)} className="w-full bg-red-600 hover:bg-red-700 py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl transition-all disabled:opacity-50">Purge {selectedChannels.size} Channels</button>
                  </div>
                ) : (
                  <div className="h-full min-h-[400px] flex flex-col items-center justify-center border-2 border-dashed border-gray-800 rounded-3xl p-12 text-center text-gray-600">
                    <ShieldCheck className="w-12 h-12 mb-4 opacity-20" />
                    <p className="font-bold uppercase tracking-widest text-xs">Ready for Scan</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showConfirmModal && (
          <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-6 z-[300]">
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="bg-gray-900 border border-red-500/30 rounded-3xl p-10 max-w-md w-full space-y-6 text-center">
              <ShieldAlert className="w-12 h-12 text-red-500 mx-auto" />
              <h2 className="text-3xl font-bold">Confirm Purge</h2>
              <p className="text-gray-400 text-sm">Type <span className="text-red-500 font-bold">DELETE</span> to permanently remove messages from {selectedChannels.size} channels.</p>
              <input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value.toUpperCase())} className="w-full bg-black border border-gray-800 p-4 rounded-xl text-center text-red-500 font-black tracking-widest outline-none" placeholder="DELETE" />
              <div className="flex gap-4">
                <button onClick={() => setShowConfirmModal(false)} className="flex-1 py-4 text-gray-500 font-bold uppercase text-xs">Abort</button>
                <button disabled={confirmText !== 'DELETE'} onClick={startDeletion} className="flex-1 bg-red-600 py-4 rounded-xl font-bold text-xs uppercase tracking-widest transition-all">Execute</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isDeleting && (
          <div className="fixed inset-0 bg-gray-950/95 flex flex-col items-center justify-center p-10 text-center z-[400]">
            <h2 className="text-5xl font-black italic tracking-tighter mb-12">PURGING...</h2>
            {deletionProgress ? (
              <div className="w-full max-w-xl space-y-8">
                <div className="w-full h-2 bg-gray-900 rounded-full overflow-hidden border border-white/5">
                  <motion.div animate={{ width: `${(deletionProgress.current_channel / deletionProgress.total_channels) * 100}%` }} className="h-full bg-blue-600 shadow-[0_0_20px_blue]" />
                </div>
                <div className="grid grid-cols-2 gap-8">
                  <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800"><p className="text-[10px] text-gray-500 uppercase mb-1">Deleted</p><p className="text-2xl font-bold text-red-500">{deletionProgress.deleted_count}</p></div>
                  <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800"><p className="text-[10px] text-gray-500 uppercase mb-1">Status</p><p className="text-2xl font-bold text-blue-500 uppercase">{deletionProgress.status}</p></div>
                </div>
              </div>
            ) : <div className="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full" />}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
