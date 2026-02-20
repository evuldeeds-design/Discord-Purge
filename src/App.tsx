import React, { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAuthStore } from './store/authStore';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Monitor, Smartphone, Key, Globe, ShieldCheck, ShieldAlert, 
  CheckCircle2, XCircle, ArrowLeft, RefreshCw, 
  Trash2, Server, Hash, Clock, Settings, LogOut, UserMinus,
  ChevronRight, LayoutDashboard, MessageSquare, Shield,
  Info, AlertCircle, Users, Search, Filter, HelpCircle, 
  Eye, Ghost, Play, Plus, Pause, Square, Hammer, Cloud
} from 'lucide-react';

// --- Types ---
interface DiscordUser { id: string; username: string; avatar?: string; email?: string; }
interface DiscordStatus { is_running: boolean; rpc_available: boolean; browser_detected: boolean; }
interface Guild { id: string; name: string; icon?: string; }
interface Channel { id: string; name: string; channel_type: number; }
interface Relationship { id: string; nickname?: string; user: { id: string, username: string, avatar?: string }; rel_type: number; }
interface DiscordIdentity { id: string; username: string; is_oauth: boolean; }
interface Progress { current: number; total: number; id: string; deleted_count?: number; status: string; }
interface OperationStatus { is_running: boolean; is_paused: boolean; should_abort: boolean; }

// --- Sub-Components ---

const IconButton = ({ icon: Icon, onClick, disabled, className = "" }: { icon: any, onClick?: () => void, disabled?: boolean, className?: string }) => (
  <button onClick={onClick} disabled={disabled} className={`p-2 rounded-full hover:bg-m3-onSurface/10 active:bg-m3-onSurface/20 transition-colors disabled:opacity-30 flex items-center justify-center focus:outline-none ${className}`}><Icon className="w-5 h-5" /></button>
);

const M3Card = ({ children, className = "", onClick }: { children: React.ReactNode, className?: string, onClick?: () => void }) => (
  <div onClick={onClick} className={`m3-card ${onClick ? 'cursor-pointer hover:bg-m3-surfaceVariant/50 active:scale-[0.98]' : ''} ${className}`}>{children}</div>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-xs font-bold text-m3-primary uppercase tracking-[0.2em] mb-4 flex items-center gap-2 px-2">{children}</h3>
);

const UserManual = ({ onComplete }: { onComplete: () => void }) => {
  const [step, setStep] = useState(0);
  const steps = [
    { title: "I. Core Protocols", icon: Shield, content: "This unit operates on two security layers. 'Official Gate' uses OAuth2 for public server management. 'Bypass Mode' (User Token) is required for private buffers like DMs and Friends. Use Bypass Mode for deep cleanup missions." },
    { title: "II. Developer Linkage", icon: Globe, content: "Navigate to discord.com/developers. Create an Application. Under OAuth2 > General, find your Client ID and Client Secret." },
    { title: "III. Port Authorization", icon: Server, content: "CRITICAL: You must add 'http://127.0.0.1:58123' to the Redirect URIs in your Discord Portal." },
    { title: "IV. Token Extraction", icon: Key, content: "For Bypass Mode: Open Discord in a browser. F12 > Network tab. Filter by '/api'. Find 'Authorization' header in any request." },
    { title: "V. Operational Safety", icon: AlertCircle, content: "Cleanup actions are PERMANENT. Use 'Simulation Mode' to test your range before execution. Proceed with focus." }
  ];
  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-2xl m3-card-elevated p-12 relative border-m3-primary/10 bg-black/40 backdrop-blur-xl">
      <div className="flex items-center justify-between mb-12"><div className="flex flex-col gap-2"><h2 className="text-4xl font-black italic uppercase tracking-tighter text-white">System Manual</h2><p className="text-[10px] text-m3-primary font-black uppercase tracking-[0.4em] italic">Operational Initialization Sequence</p></div><div className="text-5xl font-black text-white/5 italic">0{step + 1}</div></div>
      <div className="min-h-[220px] flex flex-col justify-center"><AnimatePresence mode="wait"><motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex gap-8 items-start"><div className="p-6 rounded-[2.5rem] bg-m3-primaryContainer/10 border border-m3-primary/20 text-m3-primary shadow-inner">{React.createElement(steps[step].icon, { className: "w-12 h-12" })}</div><div className="flex-1 space-y-4"><h3 className="text-2xl font-black uppercase italic text-m3-primary tracking-tight">{steps[step].title}</h3><p className="text-sm text-m3-onSurfaceVariant leading-relaxed font-bold uppercase tracking-wide opacity-90">{steps[step].content}</p></div></motion.div></AnimatePresence></div>
      <div className="mt-12 flex items-center justify-between">
        <div className="flex gap-3">{steps.map((_, i) => <div key={i} className={`h-1.5 transition-all duration-500 rounded-full ${i === step ? 'w-12 bg-m3-primary' : 'w-2 bg-m3-outlineVariant'}`} />)}</div>
        <div className="flex gap-4">{step > 0 && <button onClick={() => setStep(s => s - 1)} className="p-4 rounded-full border border-m3-outlineVariant text-m3-onSurfaceVariant hover:bg-white/5 transition-colors"><ArrowLeft className="w-5 h-5" /></button>}<button onClick={() => step < steps.length - 1 ? setStep(s => s + 1) : onComplete()} className="m3-button-primary !px-12 !py-5 shadow-xl shadow-m3-primary/20">{step < steps.length - 1 ? "Next Phase" : "Acknowledge & Start"}<ChevronRight className="w-4 h-4" /></button></div>
      </div>
    </motion.div>
  );
};

function App() {
  const { isAuthenticated, user, guilds, isLoading, error, setAuthenticated, setLoading, setError, setGuilds, reset } = useAuthStore();
  const [view, setView] = useState<'manual' | 'auth' | 'setup' | 'qr' | 'token' | 'dashboard'>('manual');
  const [mode, setAppMode] = useState<'messages' | 'servers' | 'identity'>('messages');
  const [selectedGuild, setSelectedGuild] = useState<Guild | null>(null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [relationships, setRelationships] = useState<Relationship[] | null>(null);
  const [previews, setPreviews] = useState<any[]>([]);
  const [identities, setIdentities] = useState<DiscordIdentity[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [selectedGuildsToLeave, setSelectedGuildsToLeave] = useState<Set<string>>(new Set());
  const [selectedRelationships, setSelectedRelationships] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [purgeReactions, setPurgeReactions] = useState(false);
  const [onlyAttachments, setOnlyAttachments] = useState(false);
  const [simulation, setSimulation] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [discordStatus, setDiscordStatus] = useState<DiscordStatus | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrScanned, setQrScanned] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [operationStatus, setOperationStatus] = useState<OperationStatus>({ is_running: false, is_paused: false, should_abort: false });

  // Formats error message for display
  const formatApiError = (err: any, fallback: string) => {
    const msg = typeof err === 'string' ? err : (err.user_message || fallback);
    const detail = err.technical_details ? ` (${err.technical_details})` : "";
    return `${msg}${detail}`;
  };

  // Handles state updates for API errors
  const handleApiError = useCallback((err: any, fallback: string) => {
    setError(formatApiError(err, fallback));
    setLoading(false);
    setIsProcessing(false);
  }, [setError, setLoading]);

  const fetchGuilds = useCallback(async () => {
    setLoading(true); try { setGuilds(await invoke('fetch_guilds')); } catch (err: any) { handleApiError(err, "Failed to load servers."); } finally { setLoading(false); }
  }, [setLoading, setGuilds, handleApiError]);

  const fetchRelationships = useCallback(async () => {
    setLoading(true); try { setRelationships(await invoke('fetch_relationships')); } catch (err: any) { handleApiError(err, "Failed to load identity links."); } finally { setLoading(false); }
  }, [setLoading, handleApiError]);

  // Fetches the list of Discord identities (accounts) available for switching in the app.
  const fetchIdentities = useCallback(async () => {
    try { setIdentities(await invoke('list_identities')); } catch (err) { console.error("Failed to fetch identities:", err); }
  }, []);
  // Attempts to restore the user's session by invoking the backend to get the current authenticated user.
  const tryRestoreSession = useCallback(async () => {
    try { await invoke('get_current_user'); } catch (err) { console.error("Failed to restore session:", err); }
  }, []);

  const handleNitroWipe = async () => {
    setLoading(true); try { await invoke('nitro_stealth_wipe'); setError("Nitro stealth wipe protocol execution complete."); } catch (err: any) { handleApiError(err, "Nitro stealth wipe failed."); } finally { setLoading(false); }
  };

  const getOperationStatus = useCallback(async () => {
    try { setOperationStatus(await invoke('get_operation_status')); } catch (err) { console.error("Failed to get op status:", err); }
  }, []);

  useEffect(() => {
    checkStatus(); tryRestoreSession(); fetchIdentities();
    const interval = setInterval(checkStatus, 5000); 
    const opInterval = setInterval(getOperationStatus, 1000); 
    return () => { clearInterval(interval); clearInterval(opInterval); };
  }, []);

  useEffect(() => {
    let unlisteners: any[] = [];
    const setup = async () => {
      unlisteners.push(await listen('auth_success', (event) => { setAuthenticated(event.payload as DiscordUser); setView('dashboard'); fetchGuilds(); fetchIdentities(); }));
      unlisteners.push(await listen<string>('qr_code_ready', (event) => { setQrUrl(event.payload); setLoading(false); }));
      unlisteners.push(await listen('qr_scanned', () => setQrScanned(true)));
      unlisteners.push(await listen('qr_cancelled', () => { setView('auth'); setLoading(false); setError("QR scan cancelled."); }));
      unlisteners.push(await listen('deletion_progress', (event) => setProgress(event.payload as Progress)));
      unlisteners.push(await listen('deletion_complete', () => { setIsProcessing(false); setProgress(null); fetchGuilds(); getOperationStatus(); }));
      unlisteners.push(await listen('leave_progress', (event) => setProgress(event.payload as Progress)));
      unlisteners.push(await listen('leave_complete', () => { setIsProcessing(false); setProgress(null); fetchGuilds(); getOperationStatus(); }));
      unlisteners.push(await listen('relationship_progress', (event) => setProgress(event.payload as Progress)));
      unlisteners.push(await listen('relationship_complete', () => { setIsProcessing(false); setProgress(null); fetchRelationships(); getOperationStatus(); }));
      unlisteners.push(await listen('audit_log_progress', (event) => setProgress(event.payload as Progress)));
      unlisteners.push(await listen('audit_log_complete', () => { setIsProcessing(false); setProgress(null); getOperationStatus(); setError("Audit Log burial complete."); }));
      unlisteners.push(await listen('webhook_progress', (event) => setProgress(event.payload as Progress)));
      unlisteners.push(await listen('webhook_complete', () => { setIsProcessing(false); setProgress(null); getOperationStatus(); setError("Webhook Ghosting complete."); }));
    };
    setup(); return () => unlisteners.forEach(u => u && u());
  }, [setAuthenticated, fetchGuilds, fetchRelationships, fetchIdentities, getOperationStatus]);

  const checkStatus = async () => { 
    try { 
      setDiscordStatus(await invoke('check_discord_status')); 
    } catch (err) { 
      console.error("Failed to check Discord status:", err); 
    } 
  };
  const handleLogout = async () => { reset(); setView('manual'); };
  const handleLoginOAuth = async () => { setLoading(true); setError(null); try { await invoke('start_oauth_flow'); } catch (err: any) { if (err.error_code === 'credentials_missing') { setView('setup'); setError(err.user_message); } else { handleApiError(err, "OAuth handshake failed."); } setLoading(false); } };
  const handleLoginQR = async () => { setView('qr'); setLoading(true); setQrUrl(null); setQrScanned(false); try { await invoke('start_qr_login_flow'); } catch (err: any) { handleApiError(err, "QR Gateway failed."); setView('auth'); } };
  const handleLoginRPC = async () => { setLoading(true); setError(null); try { await invoke('login_with_rpc'); } catch (err: any) { if (err.error_code === 'credentials_missing') { setView('setup'); setError(err.user_message); } else { handleApiError(err, "RPC handshake failed."); } } };
  const handleLoginToken = async (e: React.FormEvent) => { e.preventDefault(); setLoading(true); try { await invoke('login_with_user_token', { token: manualToken.trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '') }); } catch (err: any) { handleApiError(err, "Identity validation failed."); } };
  const handleSaveConfig = async (e: React.FormEvent) => { e.preventDefault(); setLoading(true); try { await invoke('save_discord_credentials', { clientId, clientSecret }); setView('auth'); setError(null); setTimeout(handleLoginOAuth, 1500); } catch (err: any) { handleApiError(err, "Secure storage failure."); } };
  
  const handleSwitchIdentity = async (id: string) => {
    setLoading(true); try { await invoke('switch_identity', { id }); } catch (err: any) { handleApiError(err, "Switch failed."); } finally { setLoading(false); }
  };

  const handleStealthWipe = async () => {
    setLoading(true); try { await invoke('stealth_privacy_wipe'); setError("Stealth protocol execution complete."); } catch (err: any) { handleApiError(err, "Stealth wipe failed."); } finally { setLoading(false); }
  };

  const handleSelectGuild = async (guild: Guild | null) => {
    setSelectedGuild(guild); setChannels(null); setSelectedChannels(new Set()); setPreviews([]);
    if (mode === 'messages' || mode === 'servers') {
      setLoading(true); try { setChannels(await invoke('fetch_channels', { guildId: guild?.id || null })); } catch (err: any) { handleApiError(err, "Buffer mapping failed."); } finally { setLoading(false); }
    }
  };

  const fetchPreview = async (channelId: string) => {
    try { setPreviews(await invoke('fetch_preview_messages', { channelId })); } catch (err) {}
  };

  const handlePause = async () => { await invoke('pause_operation'); getOperationStatus(); };
  const handleResume = async () => { await invoke('resume_operation'); getOperationStatus(); };
  const handleAbort = async () => { await invoke('abort_operation'); getOperationStatus(); setIsProcessing(false); setProgress(null); };

  const handleBuryAuditLog = async () => {
    if (!selectedGuild || !channels || selectedChannels.size === 0) {
      setError("Please select a guild and at least one channel for audit log burial.");
      return;
    }
    setLoading(true);
    try {
      const channelId = Array.from(selectedChannels)[0]; 
      await invoke('bury_audit_log', { guildId: selectedGuild.id, channelId });
      setError("Audit log burial initiated. Check Discord's audit log for details.");
    } catch (err: any) {
      handleApiError(err, "Failed to bury audit log.");
    } finally {
      setLoading(false);
    }
  };

  const handleWebhookGhosting = async () => {
    if (!selectedGuild) { setError("Please select a guild for webhook ghosting."); return; }
    setLoading(true);
    try { await invoke('webhook_ghosting', { guildId: selectedGuild.id }); setError("Webhook Ghosting initiated."); } catch (err: any) { handleApiError(err, "Failed to perform webhook ghosting."); } finally { setLoading(false); }
  };

  const startAction = async () => {
    const required = mode === 'messages' ? 'DELETE' : mode === 'servers' ? 'LEAVE' : 'REMOVE';
    if (confirmText !== required) return; setIsProcessing(true); setConfirmText('');
    try {
      if (mode === 'messages') {
        const now = Date.now();
        let start = timeRange === '24h' ? now - 86400000 : timeRange === '7d' ? now - 604800000 : undefined;
        await invoke('bulk_delete_messages', { channelIds: Array.from(selectedChannels), startTime: start, endTime: undefined, searchQuery: searchQuery || undefined, purgeReactions, simulation, onlyAttachments });
      } else if (mode === 'servers') {
        await invoke('bulk_leave_guilds', { guildIds: Array.from(selectedGuildsToLeave) });
      } else if (mode === 'identity') {
        await invoke('bulk_remove_relationships', { userIds: Array.from(selectedRelationships) });
      }
    } catch (err: any) { handleApiError(err, "Protocol execution error."); }
  };

  const renderAuth = () => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-6 p-4">
      <div className="space-y-6">
        <M3Card className="flex flex-col gap-6 p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-m3-lg bg-m3-primaryContainer text-m3-onPrimaryContainer"><Monitor className="w-6 h-6" /></div>
            <div><h3 className="font-bold text-lg">Local Handshake</h3><p className="text-xs text-m3-onSurfaceVariant">Zero-config link via desktop app</p></div>
          </div>
          <div className="flex items-center justify-between p-4 bg-m3-surfaceVariant/50 rounded-m3-lg border border-m3-outlineVariant shadow-inner">
            <div className="flex items-center gap-3"><div className={`w-2 h-2 rounded-full ${discordStatus?.is_running ? 'bg-green-500 shadow-[0_0_8px_green]' : 'bg-m3-outline'}`} /><span className="text-xs font-bold uppercase tracking-wider">Discord Process</span></div>
            <span className="text-[10px] font-black text-m3-onSurfaceVariant tracking-widest">{discordStatus?.is_running ? 'DETECTED' : 'NOT FOUND'}</span>
          </div>
          <button onClick={handleLoginRPC} disabled={!discordStatus?.rpc_available || isLoading} className="m3-button-primary w-full shadow-lg"><ShieldCheck className="w-4 h-4" />Instant Link</button>
        </M3Card>
        <M3Card onClick={() => setView('qr')} className="flex flex-col items-center gap-4 text-center group py-8">
          <div className="p-4 rounded-full bg-m3-secondaryContainer text-m3-onSecondaryContainer group-hover:scale-110 transition-transform shadow-md"><Smartphone className="w-8 h-8" /></div>
          <div><h3 className="font-bold text-lg leading-none">QR Signature</h3><p className="text-xs text-m3-onSurfaceVariant mt-2 uppercase tracking-widest font-bold">Mobile bridge</p></div>
        </M3Card>
      </div>
      <div className="space-y-6">
        <div className="m3-card-elevated flex flex-col gap-6 !bg-m3-primaryContainer !text-m3-onPrimaryContainer border-none relative overflow-hidden h-full shadow-2xl p-6">
          <Globe className="absolute -right-8 -bottom-8 w-40 h-40 opacity-10 pointer-events-none" />
          <div className="flex items-center gap-4 relative z-10">
            <div className="p-3 rounded-m3-lg bg-m3-onPrimaryContainer/10 shadow-inner"><Shield className="w-6 h-6" /></div>
            <div><h3 className="font-bold text-lg">Official Gate</h3><p className="text-xs opacity-70">Secured OAuth2 Authorization</p></div>
          </div>
          <p className="text-sm leading-relaxed opacity-80 relative z-10 flex-1">Standard linkage using the official Discord authorization protocol. Requires Application ID and Secret (fixed port 58123).</p>
          <div className="flex gap-3 relative z-10">
            <button onClick={() => setView('setup')} className="p-3 rounded-m3-full bg-m3-onPrimaryContainer/10 hover:bg-m3-onPrimaryContainer/20 transition-colors focus:outline-none"><Settings className="w-5 h-5" /></button>
            <button onClick={handleLoginOAuth} disabled={isLoading} className="m3-button-primary flex-1 !bg-m3-onPrimaryContainer !text-m3-primaryContainer shadow-xl">Start Authorize Loop</button>
          </div>
        </div>
        <M3Card onClick={() => setView('token')} className="flex items-center justify-between group py-6 px-6">
          <div className="flex items-center gap-4"><div className="p-3 rounded-m3-lg bg-m3-errorContainer text-m3-onErrorContainer shadow-sm"><Key className="w-6 h-6" /></div><div><h3 className="font-bold text-lg">Bypass Mode</h3><p className="text-xs text-m3-onSurfaceVariant mt-1 uppercase tracking-widest font-bold">Manual Injection</p></div></div>
          <ChevronRight className="w-5 h-5 text-m3-outline group-hover:translate-x-1 transition-transform" />
        </M3Card>
      </div>
    </motion.div>
  );

  const renderSetup = () => (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md m3-card-elevated relative p-10 border-m3-primary/20">
      <IconButton icon={ArrowLeft} onClick={() => setView('auth')} className="absolute top-6 left-6" />
      <div className="text-center mb-10"><h3 className="text-3xl font-black italic tracking-tighter uppercase text-m3-primary">Engine Setup</h3><p className="text-[10px] text-m3-onSurfaceVariant mt-2 uppercase tracking-[0.4em] font-black">Persistence Protocol</p></div>
      <form onSubmit={handleSaveConfig} className="flex flex-col gap-8">
        <div className="flex flex-col gap-2"><label className="text-[10px] font-black text-m3-primary uppercase tracking-widest ml-4">Application ID</label><input type="text" required value={clientId} onChange={e => setClientId(e.target.value)} className="m3-input-filled shadow-inner" placeholder="123456789..." /></div>
        <div className="flex flex-col gap-2"><label className="text-[10px] font-black text-m3-primary uppercase tracking-widest ml-4">Client Secret</label><input type="password" required value={clientSecret} onChange={e => setClientSecret(e.target.value)} className="m3-input-filled shadow-inner" placeholder="••••••••" /></div>
        <div className="p-4 bg-m3-surfaceVariant/30 rounded-m3-lg border border-m3-outlineVariant"><p className="text-[9px] font-bold text-m3-onSurfaceVariant leading-relaxed italic uppercase tracking-wider">Note: In Discord Dev Portal, you MUST add "http://127.0.0.1:58123" to Redirect URIs.</p></div>
        <button type="submit" disabled={isLoading} className="m3-button-primary !py-5 shadow-2xl shadow-m3-primary/20"><RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />Save & Connect</button>
      </form>
    </motion.div>
  );

  const renderQR = () => (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md m3-card flex flex-col items-center p-12 text-center border-m3-primary/20">
      <div className="w-full flex justify-start mb-8"><IconButton icon={ArrowLeft} onClick={() => setView('auth')} /></div>
      <div className="bg-white p-8 rounded-m3-xl shadow-[0_0_60px_rgba(255,255,255,0.1)] mb-10 relative">
        {qrUrl ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}><QRCodeSVG value={qrUrl} size={220} level="H" includeMargin /></motion.div> : <div className="w-[220px] h-[220px] flex flex-col items-center justify-center gap-4 bg-gray-100 rounded-2xl"><RefreshCw className="w-10 h-10 text-m3-primary animate-spin" /><p className="text-[10px] font-black text-m3-primary uppercase tracking-widest animate-pulse">Syncing Gateway</p></div>}
      </div>
      <h4 className="text-2xl font-black italic uppercase tracking-tight mb-2">Scan Signature</h4>
      <p className="text-xs text-m3-onSurfaceVariant px-8 leading-relaxed font-bold uppercase tracking-wide">{qrScanned ? <span className="text-m3-primary flex items-center justify-center gap-3 animate-pulse"><CheckCircle2 className="w-5 h-5" /> Signal Detected. Confirm on device.</span> : "Use the Discord Mobile app scanner (Settings > Scan QR Code)."}</p>
    </motion.div>
  );

  const renderToken = () => (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md m3-card relative p-12 border-m3-error/20">
      <IconButton icon={ArrowLeft} onClick={() => setView('auth')} className="absolute top-6 left-6" />
      <div className="text-center mb-10"><h3 className="text-3xl font-black italic tracking-tighter uppercase text-m3-error">Token Inject</h3><p className="text-[10px] text-m3-error mt-2 uppercase tracking-[0.4em] font-black opacity-60">High-Level Bypass</p></div>
      <form onSubmit={handleLoginToken} className="flex flex-col gap-10">
        <div className="flex flex-col gap-2"><label className="text-[10px] font-black text-m3-error uppercase tracking-widest ml-4">Auth Signature</label><input type="password" required value={manualToken} onChange={e => setManualToken(e.target.value)} className="m3-input-filled !border-m3-error/30 !text-m3-error !bg-m3-errorContainer/5 shadow-inner" placeholder="NJAY..." /></div>
        <button type="submit" disabled={isLoading} className="m3-button-primary !bg-m3-error !text-m3-onError !py-5 shadow-2xl shadow-m3-error/20">Establish Secure Link</button>
        <div className="p-5 bg-m3-errorContainer/10 rounded-m3-xl border border-m3-errorContainer/20">
          <div className="flex items-center gap-3 mb-4 text-m3-error"><Info className="w-4 h-4" /><span className="text-[10px] font-black uppercase tracking-widest">Extraction Protocol</span></div>
          <ol className="text-[10px] font-bold text-m3-onSurfaceVariant space-y-2 uppercase tracking-wide leading-relaxed">
            <li>1. Open Discord in Chrome/Firefox browser.</li>
            <li>2. Press F12 or Right Click &gt; Inspect.</li>
            <li>3. Go to the 'Network' tab.</li>
            <li>4. Type '/api' in the filter box.</li>
            <li>5. Click any request (e.g., 'library' or 'science').</li>
            <li>6. Find 'Authorization' under 'Request Headers'.</li>
            <li>7. Copy the long code and paste it above.</li>
          </ol>
        </div>
      </form>
    </motion.div>
  );

  const renderAuthView = () => (
    <AnimatePresence mode="wait">
      {view === 'manual' && <UserManual onComplete={() => setView('auth')} />}
      {view === 'auth' && renderAuth()}
      {view === 'setup' && renderSetup()}
      {view === 'qr' && renderQR()}
      {view === 'token' && renderToken()}
    </AnimatePresence>
  );

  const renderDashboard = () => (
    <div className="w-full h-full flex gap-10 p-4">
      <aside className="w-80 flex flex-col gap-8">
        <div className="flex flex-col gap-4 flex-1">
          <SectionLabel><Users className="w-3.5 h-3.5" /> Identities</SectionLabel>
          <div className="flex flex-col gap-2 p-2 bg-black/20 rounded-m3-xl border border-m3-outlineVariant/20">
            {identities.map(id => (
              <button key={id.id} onClick={() => handleSwitchIdentity(id.id)} className={`flex items-center gap-3 p-3 rounded-m3-lg transition-all text-left ${user?.id === id.id ? 'bg-m3-primaryContainer text-m3-onPrimaryContainer' : 'hover:bg-m3-surfaceVariant/40 text-m3-onSurfaceVariant'}`}>
                <div className="w-8 h-8 rounded-full bg-m3-secondaryContainer flex items-center justify-center font-black text-xs uppercase">{id.username[0]}</div>
                <div className="flex-1 min-w-0"><p className="text-[11px] font-black truncate uppercase italic">{id.username}</p><p className="text-[8px] opacity-50 uppercase tracking-widest">{id.is_oauth ? 'OFFICIAL' : 'BYPASS'}</p></div>
                {user?.id === id.id && <div className="w-1.5 h-1.5 rounded-full bg-m3-primary animate-pulse" />}
              </button>
            ))}
            <button onClick={() => setView('auth')} className="flex items-center gap-3 p-3 rounded-m3-lg hover:bg-m3-surfaceVariant/40 text-m3-onSurfaceVariant border border-dashed border-m3-outlineVariant/40"><Plus className="w-4 h-4" /><span className="text-[10px] font-black uppercase tracking-widest">New Protocol</span></button>
          </div>
          <SectionLabel><Server className="w-3.5 h-3.5" /> Source Handshakes</SectionLabel>
          <div className="m3-card !p-2 max-h-[calc(100vh-480px)] overflow-y-auto custom-scrollbar flex flex-col gap-1.5 shadow-inner bg-black/20 border-m3-outlineVariant/20">
            <button onClick={() => handleSelectGuild(null)} className={`flex items-center gap-4 p-4 rounded-m3-xl transition-all text-left relative group ${selectedGuild === null ? 'bg-m3-primaryContainer text-m3-onPrimaryContainer shadow-lg' : 'hover:bg-m3-surfaceVariant/40 text-m3-onSurfaceVariant'}`}><div className="relative"><div className="w-10 h-10 rounded-m3-md bg-m3-tertiaryContainer text-m3-onTertiaryContainer flex items-center justify-center font-black text-sm border border-white/5 shadow-md"><MessageSquare className="w-5 h-5" /></div>{selectedGuild === null && <motion.div layoutId="pulse-active" className="absolute -inset-1 rounded-m3-lg border border-m3-primary animate-pulse" />}</div><div className="flex-1 min-w-0"><span className="text-[13px] font-black truncate block uppercase italic tracking-tight">Direct Messages</span><p className="text-[9px] opacity-50 font-bold uppercase tracking-widest mt-0.5">Private Buffers</p></div></button>
            <div className="h-px bg-white/5 my-2 mx-4" />
            {guilds?.map(g => (
              <button key={g.id} onClick={() => handleSelectGuild(g)} className={`flex items-center gap-4 p-4 rounded-m3-xl transition-all text-left relative group ${selectedGuild?.id === g.id ? 'bg-m3-primaryContainer text-m3-onPrimaryContainer shadow-lg' : 'hover:bg-m3-surfaceVariant/40 text-m3-onSurfaceVariant'}`}><div className="relative">{g.icon ? <img src={`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`} className="w-10 h-10 rounded-m3-md shadow-md border border-white/5" /> : <div className="w-10 h-10 rounded-m3-md bg-m3-secondaryContainer text-m3-onSecondaryContainer flex items-center justify-center font-black text-sm border border-white/5 uppercase">{g.name[0]}</div>}{selectedGuild?.id === g.id && <motion.div layoutId="pulse-active" className="absolute -inset-1 rounded-m3-lg border border-m3-primary animate-pulse" />}</div><div className="flex-1 min-w-0"><span className="text-[13px] font-black truncate block uppercase italic tracking-tight">{g.name}</span><p className="text-[9px] opacity-50 font-bold uppercase tracking-widest mt-0.5">Stream Ready</p></div></button>
            ))}
          </div>
        </div>
        <div className="mt-auto space-y-4">
          <button onClick={handleStealthWipe} className="w-full flex items-center justify-center gap-3 p-4 rounded-m3-xl bg-m3-secondaryContainer/10 text-m3-secondary hover:bg-m3-secondaryContainer/20 transition-all border border-m3-secondary/20 font-black uppercase tracking-widest text-[10px] italic"><Ghost className="w-4 h-4" />Stealth Profile Wipe</button>
          <button onClick={handleNitroWipe} className="w-full flex items-center justify-center gap-3 p-4 rounded-m3-xl bg-m3-secondaryContainer/10 text-m3-secondary hover:bg-m3-secondaryContainer/20 transition-all border border-m3-secondary/20 font-black uppercase tracking-widest text-[10px] italic"><Ghost className="w-4 h-4" />Nitro Stealth Wipe</button>
          <button onClick={handleLogout} className="w-full flex items-center justify-center gap-3 p-4 rounded-m3-xl bg-m3-errorContainer/10 text-m3-error hover:bg-m3-errorContainer/20 transition-all border border-m3-error/20 font-black uppercase tracking-widest text-[10px] italic"><LogOut className="w-4 h-4" />Terminate Session</button>
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-w-0">
        <AnimatePresence mode="wait">
          <motion.div key={selectedGuild?.id || 'dms'} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className="flex-1 flex flex-col gap-10">
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-6">
                <div className="p-5 rounded-m3-xl bg-m3-surfaceVariant shadow-lg border border-m3-outlineVariant/30 text-m3-onSurfaceVariant group relative overflow-hidden"><div className="absolute inset-0 bg-m3-primary/5 animate-pulse" /><Server className="w-8 h-8 relative z-10" /></div>
                <div><h2 className="text-5xl font-black italic tracking-tighter uppercase leading-none text-white">{selectedGuild?.name || 'Direct Messages'}</h2><div className="flex items-center gap-3 mt-4 bg-m3-primary/10 w-fit px-4 py-1.5 rounded-full border border-m3-primary/20 shadow-inner"><div className="w-2 h-2 bg-m3-primary rounded-full animate-pulse shadow-[0_0_10px_rgba(208,188,255,0.8)]" /><p className="text-[10px] text-m3-primary font-black uppercase tracking-[0.4em] italic leading-none">Node Connection Established</p></div></div>
              </div>
              <div className="flex bg-m3-surfaceVariant rounded-m3-full p-1.5 border border-m3-outlineVariant shadow-inner">
                <button onClick={() => setAppMode('messages')} className={`px-8 py-2.5 rounded-m3-full text-[10px] font-black uppercase tracking-widest transition-all ${mode === 'messages' ? 'bg-m3-primary text-m3-onPrimary' : 'text-m3-onSurfaceVariant'}`}>Messages</button>
                {selectedGuild && <button onClick={() => setAppMode('servers')} className={`px-8 py-2.5 rounded-m3-full text-[10px] font-black uppercase tracking-widest transition-all ${mode === 'servers' ? 'bg-m3-primary text-m3-onPrimary' : 'text-m3-onSurfaceVariant'}`}>Servers</button>}
                <div className="w-px bg-white/10 mx-2" /><button onClick={() => setView('manual')} className="p-2.5 text-m3-onSurfaceVariant hover:text-m3-primary transition-colors"><HelpCircle className="w-5 h-5" /></button>
              </div>
            </div>
            {mode === 'messages' ? (
              <M3Card className="grid grid-cols-1 lg:grid-cols-2 gap-10 flex-1 border-m3-primary/10 shadow-2xl p-10">
                  <div className="flex flex-col gap-8">
                    <div className="space-y-4">
                      <SectionLabel><Clock className="w-3.5 h-3.5" /> Range & Simulations</SectionLabel>
                      <div className="grid grid-cols-3 gap-3 p-2 bg-black/40 rounded-m3-xl border border-m3-outlineVariant/30 shadow-inner">{([ '24h', '7d', 'all' ] as const).map(r => <button key={r} onClick={() => setTimeRange(r)} className={`py-4 rounded-m3-lg text-[10px] font-black uppercase tracking-widest transition-all ${timeRange === r ? 'bg-m3-secondaryContainer text-m3-onSecondaryContainer' : 'text-m3-onSurfaceVariant'}`}>{r}</button>)}</div>
                      <button onClick={() => setSimulation(!simulation)} className={`w-full flex items-center justify-between p-4 rounded-m3-xl border-2 transition-all ${simulation ? 'bg-m3-secondary/10 border-m3-secondary text-m3-secondary' : 'bg-transparent border-m3-outlineVariant/30 text-m3-onSurfaceVariant'}`}><span className="text-[10px] font-black uppercase tracking-widest">Simulation Mode (Safe Run)</span><div className={`w-10 h-6 rounded-full p-1 transition-colors ${simulation ? 'bg-m3-secondary' : 'bg-m3-outline'}`}><motion.div animate={{ x: simulation ? 16 : 0 }} className="w-4 h-4 bg-white rounded-full" /></div></button>
                    </div>
                    <div className="space-y-4"><SectionLabel><Filter className="w-3.5 h-3.5" /> Content Filters</SectionLabel><input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Filter by keyword..." className="w-full bg-black/40 border-2 border-m3-outlineVariant/30 focus:border-m3-primary rounded-m3-xl px-6 py-4 text-xs font-bold text-white outline-none transition-all shadow-inner" /><button onClick={() => setPurgeReactions(!purgeReactions)} className={`w-full flex items-center justify-between p-4 rounded-m3-xl border-2 transition-all ${purgeReactions ? 'bg-m3-primary/10 border-m3-primary text-white' : 'bg-transparent border-m3-outlineVariant/30 text-m3-onSurfaceVariant'}`}><span className="text-xs font-bold uppercase italic">Purge My Reactions</span><div className={`w-10 h-6 rounded-full p-1 transition-colors ${purgeReactions ? 'bg-m3-primary' : 'bg-m3-outline'}`}><motion.div animate={{ x: purgeReactions ? 16 : 0 }} className="w-4 h-4 bg-white rounded-full shadow-sm" /></div></button><button onClick={() => setOnlyAttachments(!onlyAttachments)} className={`w-full flex items-center justify-between p-4 rounded-m3-xl border-2 transition-all ${onlyAttachments ? 'bg-m3-primary/10 border-m3-primary text-white' : 'bg-transparent border-m3-outlineVariant/30 text-m3-onSurfaceVariant'}`}><span className="text-xs font-bold uppercase italic">Only Attachments</span><div className={`w-10 h-6 rounded-full p-1 transition-colors ${onlyAttachments ? 'bg-m3-primary' : 'bg-m3-outline'}`}><motion.div animate={{ x: onlyAttachments ? 16 : 0 }} className="w-4 h-4 bg-white rounded-full shadow-sm" /></div></button></div>
                  </div>
                  <div className="flex flex-col gap-8">
                    <div className="flex flex-col gap-4 flex-1">
                      <div className="flex items-center justify-between px-2"><SectionLabel><Hash className="w-3.5 h-3.5" /> Target Buffers</SectionLabel><button onClick={() => setSelectedChannels(new Set(channels?.map(c => c.id)))} className="text-[10px] font-black text-m3-primary uppercase underline mb-4">Map All</button></div>
                      <div className="m3-card !p-2 !bg-black/30 border-m3-outlineVariant/20 flex-1 overflow-y-auto custom-scrollbar min-h-[200px]">
                        {channels?.map(c => (
                          <div key={c.id} className="flex flex-col gap-1 mb-2">
                            <button onClick={() => { const next = new Set(selectedChannels); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); setSelectedChannels(next); if (!next.has(c.id)) setPreviews([]); else fetchPreview(c.id); }} className={`flex items-center justify-between p-4 rounded-m3-lg border-2 transition-all ${selectedChannels.has(c.id) ? 'bg-m3-primaryContainer/20 border-m3-primary text-white' : 'bg-transparent border-transparent text-m3-onSurfaceVariant'}`}>
                              <div className="flex items-center gap-3"><Hash className="w-3.5 h-3.5" /><span className="text-xs font-bold uppercase italic">{c.name}</span></div>
                              {selectedChannels.has(c.id) && <Eye className="w-3.5 h-3.5 animate-pulse text-m3-primary" />}
                            </button>
                            {selectedChannels.has(c.id) && previews.length > 0 && (
                              <div className="mx-4 p-3 bg-black/40 rounded-m3-lg border border-m3-outlineVariant/20 space-y-2">
                                {previews.map((p, i) => <div key={i} className="text-[9px] font-mono text-m3-onSurfaceVariant border-b border-white/5 pb-1 last:border-none truncate"><span className="text-m3-primary font-bold">{p.author.username}:</span> {p.content || "[Embed/File]"}</div>)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-10">
                      <SectionLabel><Settings className="w-3.5 h-3.5" /> Execution Protocol</SectionLabel>
                      <div className="bg-m3-errorContainer/5 border border-m3-errorContainer/20 rounded-m3-xl p-8 flex-1 flex flex-col items-center justify-center text-center gap-8 shadow-inner">
                        <div className="p-6 rounded-full bg-m3-errorContainer/10 border border-m3-error/20"><ShieldAlert className="w-12 h-12 text-m3-error drop-shadow-[0_0_15px_rgba(242,184,181,0.4)]" /></div>
                        <div><h4 className="text-2xl font-black italic uppercase text-m3-error tracking-tight">{simulation ? 'Simulation Run' : 'Security Required'}</h4><p className="text-[10px] text-m3-onSurfaceVariant font-bold uppercase tracking-widest mt-2 px-10 leading-relaxed">Authorized for <span className="text-white underline decoration-m3-error decoration-2 underline-offset-4">{selectedChannels.size} buffers</span>. {simulation ? 'No data will be destroyed.' : 'Permanent purge protocol.'}</p></div>
                        <div className="w-full space-y-4"><p className="text-[9px] font-black text-m3-error uppercase tracking-[0.4em] italic">Auth Signature: "DELETE"</p><input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value.toUpperCase())} className="w-full bg-black/60 border-2 border-m3-error/30 focus:border-m3-error rounded-m3-xl p-6 text-center text-m3-error font-mono text-3xl font-black tracking-[0.8em] outline-none transition-all shadow-inner uppercase" placeholder="••••" /></div>
                      </div>
                      <button disabled={selectedChannels.size === 0 || confirmText !== 'DELETE' || isProcessing} onClick={startAction} className={`m3-button-primary !py-8 !text-base shadow-2xl active:scale-[0.98] !rounded-m3-xl ${simulation ? '!bg-m3-secondary !text-m3-onSecondary' : '!bg-m3-error !text-m3-onError'}`}>{simulation ? <Play className="w-6 h-6" /> : <Trash2 className="w-6 h-6" />}{simulation ? 'Start Safety Simulation' : 'Execute Destructive Purge'}</button>
                    </div>
                  </div>
                </M3Card>
            ) : mode === 'servers' ? (
              <M3Card className="flex flex-col gap-10 flex-1 border-m3-error/10 shadow-2xl p-10">
                <div className="flex items-center justify-between border-b border-m3-outlineVariant/30 pb-8"><div className="flex items-center gap-4"><div className="p-4 rounded-m3-lg bg-m3-errorContainer text-m3-onErrorContainer shadow-lg"><Shield className="w-6 h-6" /></div><div><h3 className="text-3xl font-black italic uppercase tracking-tighter text-white leading-none">Connection Severance</h3><p className="text-[10px] text-m3-error font-black uppercase tracking-[0.4em] mt-3">Bulk Server Departure Protocol</p></div></div><button onClick={() => setSelectedGuildsToLeave(new Set(guilds?.map(g => g.id)))} className="m3-button-outlined !border-m3-primary/30 !text-m3-primary !px-8 !py-3 hover:!bg-m3-primary/10">Select All Nodes</button></div>
                <div className="m3-card !p-4 !bg-black/30 border-m3-outlineVariant/20 flex-1 overflow-y-auto custom-scrollbar min-h-[300px] shadow-inner"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{guilds?.map(g => <button key={g.id} onClick={() => { const next = new Set(selectedGuildsToLeave); if (next.has(g.id)) next.delete(g.id); else next.add(g.id); setSelectedGuildsToLeave(next); }} className={`flex items-center gap-4 p-5 rounded-m3-xl border-2 transition-all relative overflow-hidden ${selectedGuildsToLeave.has(g.id) ? 'bg-m3-errorContainer/20 border-m3-error text-white shadow-md' : 'bg-transparent border-m3-outlineVariant/20 text-m3-onSurfaceVariant hover:border-m3-outline hover:bg-m3-onSurface/5'}`}><div className="relative">{g.icon ? <img src={`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`} className="w-12 h-12 rounded-m3-md border border-white/5" /> : <div className="w-12 h-12 rounded-m3-md bg-m3-secondaryContainer text-m3-onSecondaryContainer flex items-center justify-center font-black text-sm uppercase">{g.name[0]}</div>}</div><div className="flex-1 min-w-0"><span className="text-xs font-black truncate block uppercase italic tracking-tight">{g.name}</span><p className="text-[8px] opacity-40 font-bold uppercase tracking-widest mt-1">Authorized Node</p></div><div className={`w-5 h-5 rounded-m3-xs border-2 flex items-center justify-center transition-all ${selectedGuildsToLeave.has(g.id) ? 'bg-m3-error border-m3-error scale-110' : 'border-m3-outlineVariant'}`}>{selectedGuildsToLeave.has(g.id) && <CheckCircle2 className="w-3.5 h-3.5 text-m3-onError" />}</div></button>)}</div></div>
                <div className="mt-auto flex flex-col lg:flex-row gap-8 items-center pt-8 border-t border-m3-outlineVariant/30 px-4"><div className="flex-1 flex items-center gap-6 px-6 py-5 bg-m3-errorContainer/10 rounded-m3-xl border border-m3-errorContainer/20 w-full lg:w-auto"><AlertCircle className="w-6 h-6 text-m3-error" /><div className="flex-1 min-w-0"><p className="text-[10px] font-black text-m3-error uppercase tracking-widest leading-none">Authorization Signature</p><p className="text-[9px] text-m3-onSurfaceVariant uppercase font-bold mt-1.5 italic">Type "LEAVE" to finalize connection termination</p></div><input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value.toUpperCase())} className="bg-black/60 border border-m3-error/30 rounded-m3-lg px-5 py-2.5 text-m3-error font-mono text-xl font-black tracking-widest w-36 outline-none focus:border-m3-error shadow-inner text-center uppercase" placeholder="••••" /></div><button disabled={selectedGuildsToLeave.size === 0 || confirmText !== 'LEAVE' || isProcessing} onClick={startAction} className="m3-button-primary !py-8 !px-12 !text-base !bg-m3-error !text-m3-onError shadow-2xl shadow-m3-error/30 active:scale-[0.98] w-full lg:w-auto !rounded-m3-xl"><LogOut className="w-6 h-6" />Sever {selectedGuildsToLeave.size} Connections</button></div>
                {selectedGuild && channels && channels.length > 0 && (
                  <div className="flex flex-col gap-8 pt-8 border-t border-m3-outlineVariant/30 px-4">
                    <SectionLabel><Hammer className="w-3.5 h-3.5" /> Audit Log Burial</SectionLabel>
                    <div className="space-y-4">
                      <p className="text-[10px] text-m3-onSurfaceVariant font-bold uppercase tracking-widest leading-relaxed">
                        Select a channel to perform random renames to flood the audit log. Requires server manage permissions.
                      </p>
                      <div className="m3-card !p-2 !bg-black/30 border-m3-outlineVariant/20 overflow-y-auto custom-scrollbar min-h-[100px] max-h-[200px] shadow-inner">
                        <div className="grid grid-cols-1 gap-2 p-1">
                          {channels.filter(c => c.channel_type === 0).map(c => (
                            <button 
                              key={c.id} 
                              onClick={() => { setSelectedChannels(new Set([c.id])); }}
                              className={`flex items-center justify-between p-4 rounded-m3-lg border-2 transition-all group ${selectedChannels.has(c.id) ? 'bg-m3-primaryContainer/20 border-m3-primary text-white shadow-sm' : 'bg-transparent border-transparent text-m3-onSurfaceVariant hover:bg-m3-onSurface/5'}`}
                            >
                              <div className="flex items-center gap-3"><Hash className={`w-3.5 h-3.5 ${selectedChannels.has(c.id) ? 'text-m3-primary' : 'text-m3-outline'}`} /><span className="text-xs font-bold uppercase italic">{c.name}</span></div>
                              <div className={`w-5 h-5 rounded-m3-xs border-2 flex items-center justify-center transition-all ${selectedChannels.has(c.id) ? 'bg-m3-primary border-m3-primary scale-110' : 'border-m3-outlineVariant'}`}>
                                {selectedChannels.has(c.id) && <CheckCircle2 className="w-3.5 h-3.5 text-m3-onPrimary" />}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                      <button 
                        onClick={handleBuryAuditLog} 
                        disabled={!selectedGuild || selectedChannels.size !== 1 || isLoading || isProcessing}
                        className="m3-button-primary !py-5 !bg-m3-secondary !text-m3-onSecondary w-full"
                      >
                        <Hammer className="w-4 h-4" /> Bury Audit Log
                      </button>
                    </div>
                  </div>
                )}
                {selectedGuild && (
                  <div className="flex flex-col gap-8 pt-8 border-t border-m3-outlineVariant/30 px-4">
                    <SectionLabel><Cloud className="w-3.5 h-3.5" /> Webhook Ghosting</SectionLabel>
                    <div className="space-y-4">
                      <p className="text-[10px] text-m3-onSurfaceVariant font-bold uppercase tracking-widest leading-relaxed">
                        Detect and delete webhooks created by your identity within this server. Requires server manage permissions.
                      </p>
                      <button 
                        onClick={() => handleWebhookGhosting()} 
                        disabled={!selectedGuild || isLoading || isProcessing}
                        className="m3-button-primary !py-5 !bg-m3-tertiary !text-m3-onTertiary w-full"
                      >
                        <Cloud className="w-4 h-4" /> Purge Webhooks
                      </button>
                    </div>
                  </div>
                )}
              </M3Card>
            ) : (
              <M3Card className="flex flex-col gap-10 flex-1 border-m3-tertiary/10 shadow-2xl p-10"><div className="flex items-center justify-between border-b border-m3-outlineVariant/30 pb-8"><div className="flex items-center gap-4"><div className="p-4 rounded-m3-lg bg-m3-tertiaryContainer text-m3-onTertiaryContainer shadow-lg"><Users className="w-6 h-6" /></div><div><h3 className="text-3xl font-black italic uppercase tracking-tighter text-white leading-none">Identity Purge</h3><p className="text-[10px] text-m3-tertiary font-black uppercase tracking-[0.4em] mt-3">Bulk Relationship Severance Protocol</p></div></div><div className="flex gap-4"><button onClick={() => setSelectedRelationships(new Set(relationships?.map(r => r.id)))} className="m3-button-outlined !border-m3-primary/30 !text-m3-primary !px-8 !py-3 hover:!bg-m3-primary/10">Map All Links</button></div></div>
                <div className="m3-card !p-4 !bg-black/30 border-m3-outlineVariant/20 flex-1 overflow-y-auto custom-scrollbar min-h-[300px] shadow-inner"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{relationships?.map(r => (<button key={r.id} onClick={() => { const next = new Set(selectedRelationships); if (next.has(r.id)) next.delete(r.id); else next.add(r.id); setSelectedRelationships(next); }} className={`flex flex-col gap-4 p-5 rounded-m3-xl border-2 transition-all relative overflow-hidden items-center text-center ${selectedRelationships.has(r.id) ? 'bg-m3-tertiaryContainer/20 border-m3-tertiary text-white shadow-md' : 'bg-transparent border-m3-outlineVariant/20 text-m3-onSurfaceVariant hover:border-m3-outline hover:bg-m3-onSurface/5'}`}><div className="relative">{r.user.avatar ? <img src={`https://cdn.discordapp.com/avatars/${r.user.id}/${r.user.avatar}.png`} className="w-16 h-16 rounded-full border-2 border-white/10" /> : <div className="w-16 h-16 rounded-full bg-m3-secondaryContainer text-m3-onSecondaryContainer flex items-center justify-center font-black text-xl uppercase">{r.user.username[0]}</div>}<div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-black ${r.rel_type === 1 ? 'bg-green-500' : r.rel_type === 2 ? 'bg-red-500' : 'bg-yellow-500'}`} title={r.rel_type === 1 ? 'Friend' : r.rel_type === 2 ? 'Blocked' : 'Pending'} /></div><div className="min-w-0"><span className="text-xs font-black truncate block uppercase italic tracking-tight">{r.nickname || r.user.username}</span><p className="text-[8px] opacity-40 font-bold uppercase tracking-widest mt-1">ID: {r.user.id}</p></div><div className={`w-5 h-5 rounded-m3-xs border-2 flex items-center justify-center transition-all ${selectedRelationships.has(r.id) ? 'bg-m3-tertiary border-m3-tertiary scale-110' : 'border-m3-outlineVariant'}`}>{selectedRelationships.has(r.id) && <CheckCircle2 className="w-3.5 h-3.5 text-m3-onTertiary" />}</div></button>))}</div></div>
                <div className="mt-auto flex flex-col lg:flex-row gap-8 items-center pt-8 border-t border-m3-outlineVariant/30 px-4"><div className="flex-1 flex items-center gap-6 px-6 py-5 bg-m3-tertiaryContainer/10 rounded-m3-xl border border-m3-tertiaryContainer/20 w-full lg:w-auto"><AlertCircle className="w-6 h-6 text-m3-tertiary" /><div className="flex-1 min-w-0"><p className="text-[10px] font-black text-m3-tertiary uppercase tracking-widest leading-none">Authorization Signature</p><p className="text-[9px] text-m3-onSurfaceVariant uppercase font-bold mt-1.5 italic">Type "REMOVE" to finalize link termination</p></div><input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value.toUpperCase())} className="bg-black/60 border border-m3-tertiary/30 rounded-m3-lg px-5 py-2.5 text-m3-tertiary font-mono text-xl font-black tracking-widest w-40 outline-none focus:border-m3-tertiary shadow-inner text-center uppercase" placeholder="••••" /></div><button disabled={selectedRelationships.size === 0 || confirmText !== 'REMOVE' || isProcessing} onClick={startAction} className="m3-button-primary !py-8 !px-12 !text-base !bg-m3-tertiary !text-m3-onTertiary shadow-2xl shadow-m3-tertiary/30 active:scale-[0.98] w-full lg:w-auto !rounded-m3-xl"><UserMinus className="w-6 h-6" />Nullify {selectedRelationships.size} Identities</button></div>
              </M3Card>
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );

  return (
    <div className="w-full h-full">
      <AnimatePresence mode="wait">
        {!isAuthenticated ? (
          <div key="auth-wrapper" className="min-h-screen flex flex-col items-center justify-center p-10 bg-[#0a0a0a] relative overflow-hidden">
            <div className="absolute inset-0 bg-m3-primary/5 pointer-events-none blur-[150px] rounded-full scale-150" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-16 w-full max-w-5xl relative z-10">
              <div className="text-center space-y-4">
                <motion.h1 layoutId="title" className="text-7xl font-black tracking-tighter text-white uppercase italic leading-none shadow-[0_0_30px_rgba(255,255,255,0.1)]">Discord Purge</motion.h1>
                <p className="text-xs text-m3-primary font-bold uppercase tracking-[0.8em] flex items-center justify-center gap-4 opacity-60"><div className="w-12 h-px bg-m3-primary/40" />Privacy Enforcement Unit v5.0<div className="w-12 h-px bg-m3-primary/40" /></p>
              </div>
              {renderAuthView()}
            </motion.div>
          </div>
        ) : (
          renderDashboard()
        )}
      </AnimatePresence>
      <AnimatePresence>
        {(isLoading || operationStatus.is_running) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/95 backdrop-blur-[80px] z-[500] flex flex-col items-center justify-center p-10 text-center">
            {operationStatus.is_running ? (
              <div className="w-full max-w-2xl flex flex-col items-center gap-16 px-10">
                <motion.div animate={{ scale: [1, 1.15, 1], rotate: [0, 8, -8, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }} className="p-10 rounded-[4rem] bg-m3-errorContainer/10 border-2 border-m3-error/30 shadow-[0_0_50px_rgba(242,184,181,0.1)]"><Trash2 className="w-20 h-20 text-m3-error shadow-[0_0_30px_rgba(242,184,181,0.5)]" /></motion.div>
                <div className="space-y-6 w-full px-10">
                  <div className="space-y-2"><h2 className="text-6xl font-black italic text-white uppercase tracking-tighter leading-none">{mode === 'messages' ? 'Purging Nodes' : mode === 'servers' ? 'Severing Nodes' : 'Nullifying Identity'}</h2><p className="text-[10px] text-m3-primary font-black uppercase tracking-[0.6em] animate-pulse">Execution Loop: Active</p></div>
                  <div className="w-full space-y-12 pt-10"><div className="space-y-5"><div className="flex justify-between text-[11px] font-black text-m3-onSurfaceVariant uppercase tracking-[0.2em] px-6 leading-none"><span>Saturation Level</span><span className="text-m3-primary italic">{progress?.current} / {progress?.total}</span></div><div className="w-full h-4 bg-m3-surfaceVariant/50 rounded-full overflow-hidden border border-m3-outlineVariant/30 p-1 shadow-2xl"><motion.div animate={{ width: `${((progress?.current || 0)/(progress?.total || 1))*100}%` }} className="h-full bg-gradient-to-r from-m3-primary via-m3-tertiary to-m3-error rounded-full" /></div></div><div className="grid grid-cols-2 gap-8 w-full px-4"><div className="m3-card !bg-black/40 border-m3-outlineVariant/30 flex flex-col gap-3 items-start !p-8 shadow-xl"><span className="text-[10px] font-black text-m3-onSurfaceVariant uppercase tracking-widest leading-none italic">Loop Phase</span><p className="text-3xl font-black text-m3-primary italic uppercase tracking-tighter">{progress?.status}</p></div><div className="m3-card !bg-black/40 border-m3-outlineVariant/30 flex flex-col gap-3 items-start !p-8 shadow-xl"><span className="text-[10px] font-black text-m3-onSurfaceVariant uppercase tracking-widest leading-none italic">{mode === 'messages' ? 'Items Nullified' : 'Nodes Severed'}</span><p className="text-3xl font-black text-m3-error italic uppercase tracking-tighter leading-none">{mode === 'messages' ? progress?.deleted_count : progress?.current || 0}</p></div></div><div className="w-full flex justify-center gap-4 mt-8">{operationStatus.is_paused ? <button onClick={handleResume} className="m3-button-primary !bg-m3-secondary !text-m3-onSecondary"><Play className="w-5 h-5" />Resume</button> : <button onClick={handlePause} className="m3-button-primary"><Pause className="w-5 h-5" />Pause</button>}<button onClick={handleAbort} className="m3-button-outlined !border-m3-error !text-m3-error"><Square className="w-5 h-5" />Abort</button></div></div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-12">
                <div className="relative">
                  <div className="w-32 h-32 border-4 border-m3-primary/10 border-t-m3-primary rounded-full animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center"><div className="w-12 h-12 bg-m3-primary/10 rounded-full flex items-center justify-center animate-pulse border border-m3-primary/30 shadow-inner"><ShieldCheck className="w-6 h-6 text-m3-primary shadow-[0_0_15px_rgba(208,188,255,0.8)]" /></div></div>
                </div>
                <div className="text-center space-y-4"><p className="text-xl font-black uppercase tracking-[0.8em] text-m3-primary animate-pulse italic leading-none">Synchronizing Protocol</p><div className="flex items-center justify-center gap-3 opacity-40"><div className="w-12 h-px bg-m3-onSurface" /><p className="text-[10px] text-m3-onSurfaceVariant font-bold uppercase tracking-widest">Handshake in progress</p><div className="w-12 h-px bg-m3-onSurface" /></div></div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: 100 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }} className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[600] w-full max-w-xl px-10">
            <div className="m3-card-elevated !bg-m3-errorContainer !text-m3-onErrorContainer !border-none flex items-center gap-6 shadow-[0_30px_100px_rgba(0,0,0,0.8)] p-8 rounded-[2.5rem] relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-1 bg-m3-onErrorContainer/20 group-hover:h-2 transition-all" />
              <div className="p-3 bg-m3-onErrorContainer/10 rounded-full shadow-inner"><ShieldAlert className="w-8 h-8 text-m3-onErrorContainer drop-shadow-[0_0_10px_rgba(96,20,16,0.4)]" /></div>
              <div className="flex-1 min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.4em] leading-none mb-2 italic">System Alert</p><p className="text-xs font-bold opacity-90 leading-relaxed uppercase tracking-tight">{error}</p></div>
              <IconButton icon={XCircle} onClick={() => setError(null)} className="!text-m3-onErrorContainer hover:!bg-m3-onErrorContainer/10 !p-4 !rounded-[1.5rem]" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
export default App;
