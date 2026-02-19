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

interface DiscordUser { id: string; username: string; avatar?: string; email?: string; }
interface DiscordStatus { is_running: boolean; rpc_available: boolean; browser_detected: boolean; }
interface Guild { id: string; name: string; icon?: string; }
interface Channel { id: string; name: string; }
interface DeletionProgress { current_channel: number; total_channels: number; channel_id: string; deleted_count: number; status: string; }

const HelpMarker = ({ content }: { content: React.ReactNode }) => (
  <Tooltip.Provider delayDuration={100}>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button className="text-gray-600 hover:text-blue-500 transition-colors p-1" type="button"><HelpCircle className="w-4 h-4" /></button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="bg-gray-900 border border-gray-800 p-4 rounded-xl shadow-2xl max-w-xs text-sm text-gray-300 z-[200] animate-in fade-in" sideOffset={5}>
          {content}<Tooltip.Arrow className="fill-gray-900" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
);

function App() {
  const { isAuthenticated, needsCredentials, user, guilds, isLoading, error, setAuthenticated, setUnauthenticated, setLoading, setError, setGuilds, setNeedsCredentials } = useAuthStore();
  
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

  const fetchGuilds = async () => {
    setLoading(true);
    try {
      const fetched: Guild[] = await invoke('fetch_guilds');
      setGuilds(fetched);
    } catch (err: any) {
      setError(err.user_message || "Handshake with Discord failed.");
    } finally { setLoading(false); }
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
    let unlisteners: any[] = [];
    const setup = async () => {
      unlisteners.push(await listen('auth_started', () => { setLoading(true); setError(null); }));
      unlisteners.push(await listen('auth_success', (event) => {
        setAuthenticated(event.payload as DiscordUser);
        setAuthMethod('none'); setQrUrl(null); setQrScanned(false);
        fetchGuilds();
      }));
      unlisteners.push(await listen<string>('qr_code_ready', (event) => { setQrUrl(event.payload); setLoading(false); }));
      unlisteners.push(await listen('qr_scanned', () => setQrScanned(true)));
      unlisteners.push(await listen('qr_cancelled', () => {
        setAuthMethod('none'); setQrUrl(null); setQrScanned(false);
        setError("QR Link was terminated.");
      }));
      unlisteners.push(await listen('deletion_progress', (event) => setDeletionProgress(event.payload as DeletionProgress)));
      unlisteners.push(await listen('deletion_complete', () => { setIsDeleting(false); setDeletionProgress(null); }));
    };
    setup();
    return () => unlisteners.forEach(u => u && u());
  }, []);

  const handleLoginOAuth = async () => {
    setLoading(true); setError(null);
    try { await invoke('start_oauth_flow'); } catch (err: any) {
      if (err.error_code === 'credentials_missing') setNeedsCredentials(true);
      else setError(err.user_message || "OAuth Link failed.");
      setLoading(false);
    }
  };

  const handleLoginQR = async () => {
    setAuthMethod('qr'); setLoading(true); setError(null);
    try { await invoke('start_qr_login_flow'); } catch (err: any) {
      setError(err.user_message || "QR Handshake failed.");
      setLoading(false); setAuthMethod('none');
    }
  };

  const handleLoginRPC = async () => {
    setAuthMethod('rpc'); setLoading(true); setError(null);
    try { await invoke('login_with_rpc'); } catch (err: any) {
      setError(err.user_message || "Instant Link rejected.");
      setAuthMethod('none'); setLoading(false);
    }
  };

  const handleLoginToken = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError(null);
    try { await invoke('login_with_user_token', { token: manualToken }); } catch (err: any) {
      setError(err.user_message || "Token injection failed.");
      setLoading(false);
    }
  };

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError(null);
    try {
      await invoke('save_discord_credentials', { clientId, clientSecret });
      setNeedsCredentials(false);
      setTimeout(() => handleLoginOAuth(), 200);
    } catch (err: any) { setError("Failed to persist config."); setLoading(false); }
  };

  const toggleChannel = (id: string) => {
    const next = new Set(selectedChannels);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedChannels(next);
  };

  const handleSelectGuild = async (guild: Guild) => {
    setSelectedGuild(guild); setChannels(null); setSelectedChannels(new Set());
    setLoading(true);
    try {
      const fetched: Channel[] = await invoke('fetch_channels', { guildId: guild.id });
      setChannels(fetched);
    } catch (err: any) { setError("Node mapping failed."); } finally { setLoading(false); }
  };

  const startDeletion = async () => {
    if (confirmText !== 'DELETE') return;
    setShowConfirmModal(false); setIsDeleting(true);
    const now = Date.now();
    let startTime = timeRange === '24h' ? now - 86400000 : timeRange === '7d' ? now - 604800000 : undefined;
    try {
      await invoke('bulk_delete_messages', { channelIds: Array.from(selectedChannels), startTime, endTime: undefined });
    } catch (err: any) { setError(err.user_message || "Purge execution failed."); setIsDeleting(false); }
  };

  if (needsCredentials) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-10 shadow-2xl">
          <div className="flex items-center gap-4 mb-8">
            <button onClick={() => setNeedsCredentials(false)} className="p-3 bg-gray-800 rounded-2xl hover:bg-gray-700 transition-all"><ArrowLeft className="w-5 h-5 text-gray-400" /></button>
            <h2 className="text-2xl font-black uppercase tracking-tighter">Engine Config</h2>
          </div>
          <form onSubmit={handleSaveCredentials} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-2">App ID</label>
              <input type="text" required value={clientId} onChange={e => setClientId(e.target.value)} className="w-full bg-black border border-gray-800 p-4 rounded-xl focus:border-blue-500 outline-none font-mono text-sm shadow-inner" placeholder="12345678..." />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-2">App Secret</label>
              <input type="password" required value={clientSecret} onChange={e => setClientSecret(e.target.value)} className="w-full bg-black border border-gray-800 p-4 rounded-xl focus:border-blue-500 outline-none font-mono text-sm shadow-inner" placeholder="••••••••" />
            </div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all shadow-xl shadow-blue-900/20">Persist & Connect</button>
            <div className="text-center mt-8">
              <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 font-bold uppercase underline underline-offset-4">Discord Developer Portal</a>
            </div>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-gray-100 font-sans p-10 selection:bg-blue-500/30">
      <header className="max-w-6xl mx-auto mb-16 flex items-center justify-between border-b border-gray-900 pb-10">
        <div>
          <h1 className="text-5xl font-black tracking-tighter text-white">DISCORD PURGE</h1>
          <p className="text-[10px] text-gray-600 font-black tracking-[0.6em] uppercase mt-2">Privacy Enforcement Utility v4.0</p>
        </div>
        {isAuthenticated && (
          <div className="flex items-center gap-6 bg-gray-900 border border-gray-800 p-3 pr-8 rounded-3xl shadow-2xl">
            {user?.avatar ? <img src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`} className="w-12 h-12 rounded-2xl shadow-lg border border-white/5" /> : <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center font-black text-xl">{user?.username[0]}</div>}
            <div>
              <p className="text-sm font-black tracking-tight uppercase">{user?.username}</p>
              <p className="text-[10px] text-green-500 font-black uppercase tracking-widest mt-0.5 flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" /> Authorized</p>
            </div>
            <button onClick={setUnauthenticated} className="p-3 hover:bg-red-500/10 rounded-2xl text-gray-600 hover:text-red-500 transition-all border border-transparent hover:border-red-500/20 ml-2"><XCircle className="w-5 h-5" /></button>
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto">
        <AnimatePresence mode="wait">
          {!isAuthenticated ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="grid grid-cols-1 md:grid-cols-2 gap-12">
              <section className="space-y-10">
                <div className="bg-gray-900 border border-gray-800 rounded-[3rem] p-10 shadow-2xl relative overflow-hidden">
                  <div className="flex items-center justify-between mb-10">
                    <h3 className="text-xs font-black text-gray-500 uppercase tracking-[0.4em] flex items-center gap-3"><Monitor className="w-4 h-4 text-blue-500" /> Environment</h3>
                    <HelpMarker content="Automatic handshake with your running Discord Desktop client." />
                  </div>
                  <div className="space-y-6">
                    <div className="flex items-center justify-between p-6 bg-black rounded-[1.5rem] border border-white/5 shadow-inner">
                      <span className="text-xs font-black uppercase tracking-widest text-gray-400">Desktop Process</span>
                      <span className={`text-[10px] font-black px-4 py-1.5 rounded-full ${discordStatus?.is_running ? 'bg-green-500/10 text-green-500 shadow-[0_0_15px_rgba(34,197,94,0.2)]' : 'bg-gray-800 text-gray-600'}`}>{discordStatus?.is_running ? 'ACTIVE' : 'OFFLINE'}</span>
                    </div>
                    <button onClick={handleLoginRPC} disabled={!discordStatus?.rpc_available} className={`w-full flex items-center justify-between p-6 bg-black rounded-[1.5rem] border transition-all ${discordStatus?.rpc_available ? 'border-blue-500 hover:bg-blue-500/5 hover:scale-[1.02]' : 'border-white/5 opacity-40'}`}>
                      <span className="text-sm font-black uppercase tracking-widest text-blue-400 italic">Instant Link</span>
                      <div className="flex items-center gap-2"><ShieldCheck className={`w-5 h-5 ${discordStatus?.rpc_available ? 'text-blue-500' : 'text-gray-700'}`} /><span className="text-[10px] font-black uppercase">{discordStatus?.rpc_available ? 'READY' : 'WAITING'}</span></div>
                    </button>
                  </div>
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-[3rem] p-12 text-center shadow-2xl relative group overflow-hidden">
                  <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <Smartphone className="w-14 h-14 text-gray-700 mx-auto mb-8 group-hover:text-blue-500 transition-colors" />
                  <h3 className="text-2xl font-black mb-2 tracking-tighter uppercase">Mobile Handshake</h3>
                  <p className="text-gray-500 text-xs mb-10 px-8 font-medium uppercase leading-relaxed tracking-tight">Scan secure QR signature via Discord app.</p>
                  <button onClick={handleLoginQR} className="w-full bg-blue-600/10 text-blue-400 border border-blue-500/30 py-5 rounded-[1.5rem] font-black text-[10px] uppercase tracking-[0.3em] hover:bg-blue-600 hover:text-white transition-all shadow-xl hover:shadow-blue-500/20">Generate Signature</button>
                </div>
              </section>

              <section className="space-y-10">
                <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-900 rounded-[3rem] p-12 shadow-2xl shadow-blue-900/40 relative overflow-hidden group">
                  <Globe className="absolute -right-8 -bottom-8 w-48 h-48 text-white/10 group-hover:rotate-12 transition-transform duration-700" />
                  <div className="relative z-10">
                    <h3 className="text-4xl font-black mb-4 tracking-tighter italic uppercase">Official Gate</h3>
                    <p className="text-blue-100/70 text-sm mb-12 leading-relaxed font-bold uppercase tracking-tight">Standard OAuth2 protocol. Secure & Authorized.</p>
                    <button onClick={handleLoginOAuth} className="w-full bg-white text-blue-700 py-6 rounded-[1.8rem] font-black text-xs uppercase tracking-[0.3em] hover:scale-[1.03] active:scale-95 transition-all shadow-2xl">Initialize Flow</button>
                  </div>
                </div>

                <button onClick={() => setAuthMethod('token')} className="w-full bg-gray-900 border border-gray-800 p-10 rounded-[3rem] flex items-center justify-between hover:bg-gray-800 transition-all group shadow-2xl">
                  <div className="flex items-center gap-8">
                    <div className="bg-red-500/10 p-5 rounded-[1.5rem] text-red-500 group-hover:scale-110 transition-transform shadow-inner"><Key className="w-8 h-8" /></div>
                    <div className="text-left">
                      <h4 className="text-xl font-black tracking-tighter uppercase">Manual Inject</h4>
                      <p className="text-[10px] text-gray-600 font-black uppercase tracking-[0.2em] mt-1">Advanced Bypass Protocol</p>
                    </div>
                  </div>
                  <HelpMarker content="Paste a raw account token. Warning: This bypasses all safety handshakes. Expert use only." />
                </button>
              </section>
            </motion.div>
          ) : authMethod === 'qr' ? (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md mx-auto text-center bg-gray-900 border border-gray-800 p-12 rounded-[4rem] shadow-2xl relative overflow-hidden">
              <button onClick={() => { setAuthMethod('none'); setQrUrl(null); setQrScanned(false); }} className="flex items-center gap-3 text-[10px] font-black text-gray-600 hover:text-white uppercase tracking-[0.3em] mb-12 transition-all"><ArrowLeft className="w-4 h-4" /> Abort Sequence</button>
              <div className="bg-white p-8 rounded-[3rem] inline-block mb-12 shadow-[0_0_60px_rgba(255,255,255,0.1)] border-4 border-blue-500/20">
                {qrUrl ? <QRCodeSVG value={qrUrl} size={240} level="H" includeMargin={true} /> : <div className="w-[240px] h-[240px] flex items-center justify-center bg-gray-50 rounded-[2rem]"><div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}
              </div>
              <p className="text-[10px] font-black text-gray-500 leading-relaxed px-10 uppercase tracking-[0.2em]">
                {qrScanned ? <span className="text-green-500 flex items-center justify-center gap-3 animate-pulse italic"><CheckCircle2 className="w-6 h-6" /> Signal Detected. Confirm on mobile.</span> : "Scan this secure signature with the Discord mobile app scanner."}
              </p>
            </motion.div>
          ) : authMethod === 'token' ? (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="max-w-xl mx-auto bg-gray-900 border border-gray-800 p-14 rounded-[4rem] shadow-2xl">
              <button onClick={() => setAuthMethod('none')} className="flex items-center gap-3 text-[10px] font-black text-gray-600 hover:text-white uppercase tracking-[0.3em] mb-14 transition-all"><ArrowLeft className="w-4 h-4" /> Abort Sequence</button>
              <div className="flex items-center justify-between mb-10 border-b border-gray-800 pb-8">
                <h3 className="text-3xl font-black tracking-tighter uppercase italic">Token Injection</h3>
                <HelpMarker content={<div className="space-y-4"><p className="font-black text-red-500 uppercase tracking-widest underline italic">Zero Trust Protocol</p><p className="text-xs font-bold">Your token grants TOTAL account access. Protect it like your password.</p><hr className="border-gray-800" /><p className="font-black uppercase text-[10px] text-gray-500">Extraction Guide:</p><ol className="list-decimal list-inside space-y-3 text-[11px] font-medium"><li>Open Discord Web</li><li>Tap <code className="bg-black p-1 rounded text-blue-400 font-mono">F12</code></li><li>Select <span className="text-blue-400 font-bold uppercase tracking-widest text-[9px]">Network</span></li><li>Filter <code className="bg-black p-1 rounded text-blue-400 font-mono">/api</code></li><li>Copy <span className="text-blue-400 font-bold uppercase tracking-widest text-[9px]">Authorization</span> Header</li></ol></div>} />
              </div>
              <form onSubmit={handleLoginToken} className="space-y-10">
                <div className="space-y-3">
                  <p className="text-[10px] text-gray-600 uppercase font-black tracking-[0.4em] ml-2">Secure Payload</p>
                  <input type="password" value={manualToken} onChange={e => setManualToken(e.target.value)} className="w-full bg-black border border-gray-800 p-6 rounded-[1.8rem] focus:border-red-500 outline-none font-mono text-xs shadow-inner transition-all" placeholder="INJECT_SIGNATURE_HERE" />
                </div>
                <button type="submit" disabled={!manualToken} className="w-full bg-red-600 hover:bg-red-700 py-6 rounded-[1.8rem] font-black text-xs uppercase tracking-[0.4em] transition-all disabled:opacity-50 shadow-2xl shadow-red-900/20 active:scale-95">Establish Secure Link</button>
              </form>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
              <aside className="lg:col-span-4 space-y-8">
                <h3 className="text-[10px] font-black text-gray-600 uppercase tracking-[0.5em] ml-6 flex items-center gap-3"><Server className="w-4 h-4 text-blue-500" /> Source Nodes</h3>
                <div className="bg-gray-900/40 border border-gray-800 rounded-[3.5rem] overflow-hidden max-h-[650px] overflow-y-auto custom-scrollbar p-4 space-y-3 shadow-inner">
                  {guilds?.map(g => (
                    <button key={g.id} onClick={() => handleSelectGuild(g)} className={`w-full flex items-center gap-6 p-6 rounded-[2.5rem] transition-all relative overflow-hidden group ${selectedGuild?.id === g.id ? 'bg-blue-600 text-white shadow-2xl' : 'hover:bg-white/5 text-gray-500'}`}>
                      {g.icon ? <img src={`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`} className="w-14 h-14 rounded-2xl shadow-xl transition-transform group-hover:scale-110" /> : <div className="w-14 h-14 rounded-2xl bg-gray-800 flex items-center justify-center font-black text-xl">{g.name[0]}</div>}
                      <span className="text-sm font-black tracking-tighter truncate uppercase italic">{g.name}</span>
                      {selectedGuild?.id === g.id && <div className="absolute right-8 w-2 h-2 bg-white rounded-full shadow-[0_0_15px_white]" />}
                    </button>
                  ))}
                </div>
              </aside>

              <div className="lg:col-span-8">
                {selectedGuild ? (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-gray-900 border border-gray-800 p-14 rounded-[4.5rem] space-y-12 shadow-2xl relative overflow-hidden backdrop-blur-3xl">
                    <div className="absolute top-0 right-0 p-14 opacity-[0.03]"><Trash2 className="w-48 h-48 rotate-12" /></div>
                    <div className="relative z-10 border-b border-gray-800 pb-12">
                      <h3 className="text-5xl font-black text-white tracking-tighter italic uppercase">{selectedGuild.name}</h3>
                      <p className="text-[10px] text-blue-500 font-black uppercase tracking-[0.5em] mt-4 ml-1 flex items-center gap-3"><div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" /> Node Calibration Active</p>
                    </div>
                    
                    <div className="space-y-8 relative z-10">
                      <label className="text-[10px] font-black text-gray-600 uppercase tracking-[0.4em] ml-4 flex items-center gap-3"><Clock className="w-4 h-4" /> Temporal Mapping</label>
                      <div className="flex gap-4 p-3 bg-black/40 rounded-[2rem] border border-gray-800 shadow-inner">
                        {(['24h', '7d', 'all'] as const).map(r => (
                          <button key={r} onClick={() => setTimeRange(r)} className={`flex-1 py-5 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all ${timeRange === r ? 'bg-white text-black shadow-2xl scale-105' : 'text-gray-600 hover:text-gray-300'}`}>{r === '24h' ? '24 HOURS' : r === '7d' ? '7 DAYS' : 'FULL DEPTH'}</button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-8 relative z-10">
                      <div className="flex items-center justify-between px-4">
                        <label className="text-[10px] font-black text-gray-600 uppercase tracking-[0.4em] flex items-center gap-3"><Hash className="w-4 h-4" /> Buffer Selection</label>
                        <button onClick={() => setSelectedChannels(new Set(channels?.map(c => c.id)))} className="text-[10px] font-black text-blue-500 hover:text-blue-400 uppercase tracking-[0.3em] underline decoration-2 underline-offset-8 transition-all">Map All Targets</button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-h-[400px] overflow-y-auto pr-4 custom-scrollbar p-2">
                        {channels?.map(c => (
                          <button key={c.id} onClick={() => toggleChannel(c.id)} className={`flex items-center justify-between p-6 rounded-[2.5rem] border-2 transition-all text-left ${selectedChannels.has(c.id) ? 'bg-blue-600/10 border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.15)] text-blue-100' : 'bg-black/30 border-gray-800 text-gray-600 hover:border-gray-700'}`}>
                            <span className="truncate font-black text-xs tracking-tight uppercase">#{c.name}</span>
                            <div className={`w-6 h-6 rounded-xl border-2 flex items-center justify-center transition-all ${selectedChannels.has(c.id) ? 'bg-blue-500 border-blue-500 scale-110 shadow-lg' : 'border-gray-800'}`}>{selectedChannels.has(c.id) && <CheckCircle2 className="w-4 h-4 text-white" />}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <button disabled={selectedChannels.size === 0 || isDeleting} onClick={() => setShowConfirmModal(true)} className="w-full bg-red-600 hover:bg-red-700 py-8 rounded-[2.5rem] font-black text-sm uppercase tracking-[0.4em] shadow-2xl shadow-red-900/30 transition-all hover:scale-[1.01] active:scale-95 disabled:opacity-50 relative z-10">Execute Purge Sequence ({selectedChannels.size})</button>
                  </motion.div>
                ) : (
                  <div className="h-full min-h-[550px] flex flex-col items-center justify-center border-2 border-dashed border-gray-800 rounded-[5rem] p-24 text-center opacity-30 shadow-inner">
                    <ShieldCheck className="w-20 h-20 mb-8 text-blue-500" />
                    <p className="font-black uppercase tracking-[0.6em] text-[10px]">Awaiting Node Calibration</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirmModal && (
          <div className="fixed inset-0 bg-black/98 backdrop-blur-[50px] flex items-center justify-center p-8 z-[300]">
            <motion.div initial={{ scale: 0.9, y: 30 }} animate={{ scale: 1, y: 0 }} className="bg-gray-900 border border-red-500/40 rounded-[5rem] p-20 max-w-2xl w-full space-y-12 text-center shadow-[0_0_100px_rgba(220,38,38,0.1)] relative overflow-hidden">
              <ShieldAlert className="w-20 h-20 text-red-600 mx-auto drop-shadow-[0_0_30px_red]" />
              <h2 className="text-6xl font-black tracking-tighter uppercase italic">Authorization Required</h2>
              <p className="text-gray-500 font-black text-xs uppercase tracking-[0.2em] leading-relaxed px-10">
                You are about to execute a permanent purge protocol for <span className="text-white font-black">{selectedChannels.size} target nodes</span>. This action cannot be reversed.
              </p>
              <div className="space-y-5">
                <label className="text-[10px] font-black text-gray-600 uppercase tracking-[0.5em]">Input Security Override Signature (<span className="text-red-500 underline">DELETE</span>)</label>
                <input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value.toUpperCase())} className="w-full bg-black/80 border border-gray-800 p-8 rounded-[2.5rem] text-center text-red-500 font-black tracking-[0.8em] outline-none text-2xl shadow-inner focus:border-red-500/50 transition-all uppercase italic" placeholder="SIGNATURE" />
              </div>
              <div className="flex gap-8">
                <button onClick={() => setShowConfirmModal(false)} className="flex-1 py-7 text-gray-600 font-black uppercase text-[10px] tracking-[0.4em] border border-gray-800 rounded-[2rem] hover:bg-white/5 transition-all">Abort Protocol</button>
                <button disabled={confirmText !== 'DELETE'} onClick={startDeletion} className={`flex-1 py-7 rounded-[2rem] font-black text-[10px] tracking-[0.4em] uppercase transition-all shadow-2xl ${confirmText === 'DELETE' ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-900/50 scale-105' : 'bg-gray-800 text-gray-700 cursor-not-allowed'}`}>Confirm Purge</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isDeleting && (
          <div className="fixed inset-0 bg-black flex flex-col items-center justify-center p-10 text-center z-[400]">
            <motion.h2 animate={{ scale: [1, 1.01, 1], opacity: [0.6, 1, 0.6] }} transition={{ repeat: Infinity, duration: 1.5 }} className="text-8xl font-black italic tracking-tighter mb-24 uppercase">Purge Protocol: ACTIVE</motion.h2>
            {deletionProgress ? (
              <div className="w-full max-w-2xl space-y-16 relative">
                <div className="space-y-8">
                  <div className="flex justify-between text-[10px] font-black text-gray-600 px-8 uppercase tracking-[0.6em]">
                    <span>Global Saturation</span>
                    <span className="text-blue-500">Node {deletionProgress.current_channel} / {deletionProgress.total_channels}</span>
                  </div>
                  <div className="w-full h-5 bg-gray-950 rounded-full overflow-hidden border border-white/5 p-1 shadow-inner">
                    <motion.div animate={{ width: `${(deletionProgress.current_channel / deletionProgress.total_channels) * 100}%` }} className="h-full bg-gradient-to-r from-blue-600 via-purple-600 to-red-600 shadow-[0_0_40px_blue]" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-12">
                  <div className="bg-gray-900/50 p-12 rounded-[3.5rem] border border-gray-800 shadow-2xl backdrop-blur-3xl">
                    <p className="text-[10px] text-gray-600 font-black uppercase tracking-[0.5em] mb-4 text-left italic">Status</p>
                    <p className="text-4xl font-black text-blue-500 uppercase tracking-tighter italic text-left">{deletionProgress.status}</p>
                  </div>
                  <div className="bg-gray-900/50 p-12 rounded-[3.5rem] border border-gray-800 shadow-2xl backdrop-blur-3xl">
                    <p className="text-[10px] text-gray-600 font-black uppercase tracking-[0.5em] mb-4 text-left italic">Purged</p>
                    <p className="text-4xl font-black text-red-500 tracking-tighter italic text-left">{deletionProgress.deleted_count}</p>
                  </div>
                </div>
                <div className="p-6 bg-white/5 rounded-3xl border border-white/5 inline-block backdrop-blur-xl shadow-2xl">
                  <p className="text-[10px] text-gray-500 font-black uppercase tracking-[0.6em] italic">Scanning Node Buffer: #{channels?.find(c => c.id === deletionProgress.channel_id)?.name || '0xUNKNOWN'}</p>
                </div>
              </div>
            ) : <div className="w-32 h-32 border-8 border-blue-500/10 border-t-blue-500 rounded-[3rem] animate-spin shadow-[0_0_80px_blue]" />}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
