import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { memberService, systemService } from '../services/api';
import MemberCard from '../components/MemberCard';
import MemberEditor from '../components/MemberEditor';
import ImportTool from '../components/ImportTool';
import SystemSettings from '../components/SystemSettings';
import { LogOut, Plus, Upload, Search, LayoutGrid, List, Trash2, Download, ChevronDown, Database, Edit3, Loader2, Info, Archive } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

const DashboardPage: React.FC = () => {
    const { slug: urlSlug } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const { user, token, logout } = useAuth();
    
    const [system, setSystem] = useState<any>(null);
    const [members, setMembers] = useState<any[]>([]);
    const [isOwner, setIsOwner] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    const [search, setSearch] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [selectedMember, setSelectedMember] = useState<any>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isDataMenuOpen, setIsDataMenuOpen] = useState(false);

    // Refs to avoid stale closures in SSE/fetchData
    const isModalOpenRef = React.useRef(false);
    isModalOpenRef.current = isImporting || isSettingsOpen;
    const systemRef = React.useRef<any>(null);
    systemRef.current = system;

    const fetchData = async (isBackground = false) => {
        if (!urlSlug) return;
        if (!isBackground) setLoading(true);
        
        try {
            // 1. Fetch public data
            const pubRes = await systemService.getPublic(urlSlug);
            const pubSystem = pubRes.data;
            
            setSystem(pubSystem);
            setMembers(pubSystem.members || []);
            
            // 2. Check ownership if logged in
            if (token) {
                try {
                    const ownRes = await systemService.get();
                    if (ownRes.data.slug === pubSystem.slug) {
                        setIsOwner(true);
                    } else {
                        setIsOwner(false);
                    }
                } catch (e) {
                    setIsOwner(false);
                }
            } else {
                setIsOwner(false);
            }
            
            setError(null);
            setLoading(false); 
        } catch (err: any) {
            console.error('Failed to fetch system data:', err);
            
            // Resilience: If 404 and logged in, check if our own system slug changed
            // CRITICAL: We use systemRef to know if we were already successfully viewing a system.
            if (err.response?.status === 404 && token && systemRef.current) {
                // If a modal is open, let the modal handle its own redirect/finish state.
                if (isModalOpenRef.current) {
                    setLoading(false);
                    return;
                }

                try {
                    setLoading(true); 
                    const ownRes = await systemService.get();
                    if (ownRes.data.slug !== urlSlug) {
                        console.log(`[Dashboard] Slug changed from ${urlSlug} to ${ownRes.data.slug}. Redirecting...`);
                        navigate(`/s/${ownRes.data.slug}`, { replace: true });
                        return;
                    }
                } catch (e) {
                    // Fall through to error state
                }
            }

            // Only show the global error screen if we don't have a system yet,
            // or if we aren't currently in the middle of an import/settings change.
            if (!systemRef.current || !isModalOpenRef.current) {
                setError(err.response?.data?.error || 'System not found');
            }
            setLoading(false);
        }
    };

    useEffect(() => {
        // Reset states when changing systems
        setIsImporting(false);
        setIsSettingsOpen(false);
        setIsEditing(false);
        setSystem(null);
        setError(null);
        setLoading(true);
        fetchData();
    }, [urlSlug, token]);

    useEffect(() => {
        if (!token || !isOwner) return;

        const API_BASE = import.meta.env.VITE_API_URL || '/api';
        const sseUrl = `${API_BASE}/system/events?token=${token}`;
        const eventSource = new EventSource(sseUrl);

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'SYSTEM_UPDATE') {
                fetchData(true);
            }
        };

        return () => eventSource.close();
    }, [token, isOwner, urlSlug]);

    const handleDelete = async (id: string) => {
        if (!isOwner) return;
        if (confirm('Are you sure you want to delete this system member?')) {
            try {
                await memberService.delete(id);
                fetchData(true);
            } catch (e) {
                alert('Delete failed');
            }
        }
    };

    const handleDeleteSystem = async () => {
        if (!isOwner) return;
        if (confirm('⚠️ WARNING: This will permanently delete your ENTIRE SYSTEM, including all members, and disconnect your accounts. This cannot be undone. Are you absolutely sure?')) {
            try {
                await systemService.delete();
                navigate('/setup', { replace: true });
            } catch (e) {
                alert('Failed to delete system');
            }
        }
    };

    const handleToggleAutoproxy = async (memberId: string) => {
        if (!isOwner) return;
        try {
            const newId = system?.autoproxyId === memberId ? null : memberId;
            await systemService.update({ autoproxyId: newId });
            fetchData(true);
        } catch (e) {
            alert('Failed to update autoproxy setting.');
        }
    };

    const filteredMembers = members.filter((m: any) => 
        m.name.toLowerCase().includes(search.toLowerCase()) || 
        m.slug.toLowerCase().includes(search.toLowerCase())
    ).sort((a: any, b: any) => {
        if (system?.autoproxyId) {
            if (a.id === system.autoproxyId) return -1;
            if (b.id === system.autoproxyId) return 1;
        }
        return a.slug.localeCompare(b.slug);
    });

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-matrix-dark">
                <Loader2 className="w-12 h-12 text-matrix-primary animate-spin" />
            </div>
        );
    }

    if (error || !system) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-matrix-dark text-matrix-text px-4">
                <div className="bg-matrix-light p-8 rounded-3xl border border-white/5 text-center space-y-6 max-w-md shadow-2xl">
                    <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto text-red-500">
                        <Info size={40} />
                    </div>
                    <h2 className="text-2xl font-bold">System Not Found</h2>
                    <p className="text-matrix-muted">The system with slug <b>{urlSlug}</b> could not be found or is not public.</p>
                    <Link to="/" className="matrix-button w-full flex items-center justify-center font-bold">
                        Return to My Dashboard
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen pb-20 text-matrix-text">
            {/* Header */}
            <header className="sticky top-0 z-40 bg-matrix-dark/80 backdrop-blur-md border-b border-white/5">
                <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
                    <div className="flex items-center space-x-4 overflow-hidden">
                        <Link to="/">
                            <img src="/lily.png" alt="PluralMatrix Logo" className="w-10 h-10 rounded-xl object-cover shadow-lg hover:scale-105 transition-transform" />
                        </Link>
                        <div className="min-w-0">
                            <h1 className="font-bold text-xl leading-tight">PluralMatrix</h1>
                            <p className="text-matrix-muted text-xs font-medium truncate">
                                {isOwner ? user?.mxid : "Public Profile"}
                            </p>
                        </div>
                    </div>
                    
                    <div className="flex items-center space-x-4">
                        {token ? (
                            <>
                                {!isOwner && (
                                    <Link to="/" className="text-sm font-bold text-matrix-primary hover:text-matrix-primary/80 transition-colors hidden md:block">
                                        My Dashboard
                                    </Link>
                                )}
                                <button 
                                    onClick={() => { logout(); navigate('/login'); }}
                                    data-testid="dashboard-logout-button"
                                    className="p-2 hover:bg-white/5 rounded-lg text-matrix-muted hover:text-white transition-colors flex items-center text-sm font-medium"
                                >
                                    <LogOut size={18} className="md:mr-2" /> <span className="hidden md:inline">Sign Out</span>
                                </button>
                            </>
                        ) : (
                            <Link to="/login" className="matrix-button py-2 px-6 text-sm font-bold">
                                Sign In
                            </Link>
                        )}
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 mt-12 space-y-12">
                {/* Hero / Stats */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                    <div className="space-y-2">
                        <div className="space-y-1">
                            <div className="flex items-center gap-3 group">
                                <h2 data-testid="system-title" className="text-4xl font-bold tracking-tight text-white">
                                    {system?.name || "Unnamed System"}
                                </h2>
                                {isOwner && (
                                    <button 
                                        onClick={() => setIsSettingsOpen(true)}
                                        data-testid="system-settings-button"
                                        className="p-2 hover:bg-white/5 rounded-full text-matrix-muted hover:text-matrix-primary transition-colors"
                                        title="Edit System Settings"
                                    >
                                        <Edit3 size={20} />
                                    </button>
                                )}
                            </div>
                            {system?.systemTag && (
                                <div className="text-xl font-normal text-matrix-muted/80 flex items-center">
                                    <span className="bg-white/5 px-2 py-0.5 rounded text-sm uppercase tracking-wider mr-2 text-xs font-bold font-mono">Suffix Tag</span>
                                    {system.systemTag}
                                </div>
                            )}
                        </div>
                        <p className="text-matrix-muted font-medium mt-4">This system has {members.length} registered members.</p>
                    </div>
                    
                    {isOwner && (
                        <div className="flex items-center gap-3">
                            <button 
                                onClick={() => { setSelectedMember(null); setIsEditing(true); }}
                                data-testid="add-member-button"
                                className="matrix-button flex items-center shadow-lg shadow-matrix-primary/20"
                            >
                                <Plus size={18} className="mr-2" /> Add System Member
                            </button>

                            <div className="relative">
                                <button 
                                    onClick={() => setIsDataMenuOpen(!isDataMenuOpen)}
                                    data-testid="data-menu-button"
                                    className="matrix-button-outline flex items-center"
                                >
                                    <Database size={18} className="mr-2" /> Data <ChevronDown size={16} className={`ml-2 transition-transform ${isDataMenuOpen ? 'rotate-180' : ''}`} />
                                </button>

                                <AnimatePresence>
                                    {isDataMenuOpen && (
                                        <>
                                            <div className="fixed inset-0 z-10" onClick={() => setIsDataMenuOpen(false)} />
                                            <motion.div 
                                                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                                className="absolute right-0 mt-2 w-56 bg-matrix-light border border-white/10 rounded-xl shadow-2xl z-20 py-2 overflow-hidden"
                                            >
                                                <div className="px-4 py-2 text-[10px] font-bold text-matrix-muted uppercase tracking-wider">Export</div>
                                                <button 
                                                    onClick={() => { memberService.exportBackupZip(); setIsDataMenuOpen(false); }}
                                                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 flex items-center transition-colors group"
                                                >
                                                    <Archive size={16} className="mr-3 text-matrix-primary group-hover:scale-110 transition-transform" /> 
                                                    <div className="font-bold">Export Backup (ZIP)</div>
                                                </button>
                                                <button 
                                                    onClick={() => { memberService.exportPkZip(); setIsDataMenuOpen(false); }}
                                                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 flex items-center transition-colors group"
                                                >
                                                    <Download size={16} className="mr-3 text-matrix-primary group-hover:scale-110 transition-transform" /> 
                                                    <div className="font-bold">Export for PluralKit</div>
                                                </button>

                                                <div className="h-px bg-white/5 my-2" />
                                                <div className="px-4 py-2 text-[10px] font-bold text-matrix-muted uppercase tracking-wider">Import</div>
                                                <button 
                                                    onClick={() => { setIsImporting(true); setIsDataMenuOpen(false); }}
                                                    data-testid="import-menu-button"
                                                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 flex items-center transition-colors group"
                                                >
                                                    <Upload size={16} className="mr-3 text-matrix-primary group-hover:scale-110 transition-transform" /> 
                                                    <div className="font-bold">Import System</div>
                                                </button>

                                                <div className="h-px bg-white/5 my-2" />
                                                <div className="px-4 py-2 text-[10px] font-bold text-red-400 uppercase tracking-wider">Danger Zone</div>
                                                <button 
                                                    onClick={() => { handleDeleteSystem(); setIsDataMenuOpen(false); }}
                                                    data-testid="delete-system-menu-button"
                                                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-400/10 text-red-400 flex items-center transition-colors"
                                                >
                                                    <Trash2 size={16} className="mr-3" /> Delete System
                                                </button>
                                            </motion.div>
                                        </>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    )}
                </div>

                {/* Search & Filter */}
                <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-matrix-light p-4 rounded-2xl border border-white/5 shadow-inner">
                    <div className="relative w-full md:max-w-md">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-matrix-muted" size={18} />
                        <input 
                            className="matrix-input pl-12 bg-matrix-dark/50" 
                            placeholder="Search by name or ID..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center bg-matrix-dark/50 p-1 rounded-lg">
                        <button className="p-2 bg-matrix-light shadow-sm rounded-md text-matrix-primary"><LayoutGrid size={18} /></button>
                        <button className="p-2 text-matrix-muted hover:text-white transition-colors"><List size={18} /></button>
                    </div>
                </div>

                {/* Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <AnimatePresence mode="popLayout">
                        {filteredMembers.map((member: any) => (
                            <MemberCard 
                                key={member.id} 
                                member={member} 
                                isReadOnly={!isOwner}
                                isAutoproxy={system?.autoproxyId === member.id}
                                onEdit={(m) => { setSelectedMember(m); setIsEditing(true); }}
                                onDelete={handleDelete}
                                onToggleAutoproxy={handleToggleAutoproxy}
                            />
                        ))}
                    </AnimatePresence>
                </div>

                {filteredMembers.length === 0 && (
                    <div className="text-center py-20 space-y-4">
                        <div className="w-20 h-20 bg-matrix-light rounded-full flex items-center justify-center mx-auto text-matrix-muted opacity-50">
                            <Search size={40} />
                        </div>
                        <h3 className="text-xl font-bold">No system members found</h3>
                        <p className="text-matrix-muted max-w-xs mx-auto">
                            {isOwner ? "Try a different search term or add your first system member using the button above." : "Try a different search term."}
                        </p>
                    </div>
                )}
            </main>

            {/* Modals */}
            {isEditing && (
                <MemberEditor 
                    member={selectedMember} 
                    isReadOnly={!isOwner}
                    onSave={() => { setIsEditing(false); fetchData(true); }}
                    onCancel={() => setIsEditing(false)}
                />
            )}

            {isImporting && isOwner && (
                <ImportTool 
                    onComplete={(newSlug) => { 
                        setIsImporting(false); 
                        if (newSlug && newSlug !== urlSlug) {
                            navigate(`/s/${newSlug}`);
                        } else {
                            fetchData(true); 
                        }
                    }}
                    onCancel={() => setIsImporting(false)}
                />
            )}

            {isSettingsOpen && isOwner && (
                <SystemSettings 
                    onSave={(newSlug) => { 
                        setIsSettingsOpen(false); 
                        if (newSlug && newSlug !== urlSlug) {
                            navigate(`/s/${newSlug}`);
                        } else {
                            fetchData(true); 
                        }
                    }}
                    onCancel={() => setIsSettingsOpen(false)}
                />
            )}
        </div>
    );
};

export default DashboardPage;
