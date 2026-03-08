import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { systemService } from '../services/api';
import MemberCard from '../components/MemberCard';
import MemberEditor from '../components/MemberEditor';
import { Search, LayoutGrid, List, Info, ArrowLeft, Loader2, Lock } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';

const PublicSystemPage: React.FC = () => {
    const { slug } = useParams<{ slug: string }>();
    const [system, setSystem] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [selectedMember, setSelectedMember] = useState<any>(null);

    useEffect(() => {
        const fetchPublicSystem = async () => {
            if (!slug) return;
            setLoading(true);
            try {
                const res = await systemService.getPublic(slug);
                setSystem(res.data);
                setError(null);
            } catch (err: any) {
                console.error('Failed to fetch public system:', err);
                setError(err.response?.data?.error || 'System not found');
            } finally {
                setLoading(false);
            }
        };
        fetchPublicSystem();
    }, [slug]);

    const filteredMembers = (system?.members || []).filter((m: any) => 
        m.name.toLowerCase().includes(search.toLowerCase()) || 
        m.slug.toLowerCase().includes(search.toLowerCase())
    );

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
                    <p className="text-matrix-muted">The system with slug <b>{slug}</b> could not be found or is not public.</p>
                    <Link to="/" className="matrix-button w-full flex items-center justify-center">
                        <ArrowLeft size={18} className="mr-2" /> Back to Dashboard
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
                    <div className="flex items-center space-x-4">
                        <img src="/lily.png" alt="PluralMatrix Logo" className="w-10 h-10 rounded-xl object-cover shadow-lg" />
                        <div>
                            <h1 className="font-bold text-xl leading-tight">PluralMatrix</h1>
                            <p className="text-matrix-muted text-xs font-medium italic">Public Profile</p>
                        </div>
                    </div>
                    
                    <Link to="/login" className="text-sm font-medium text-matrix-muted hover:text-white transition-colors">
                        Sign In
                    </Link>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 mt-12 space-y-12">
                {/* Hero */}
                <div className="space-y-4">
                    <div className="space-y-1">
                        <h2 className="text-4xl font-bold tracking-tight text-white">
                            {system.name || "Unnamed System"}
                        </h2>
                        {system.systemTag && (
                            <div className="text-xl font-normal text-matrix-muted/80 flex items-center">
                                <span className="bg-white/5 px-2 py-0.5 rounded text-sm uppercase tracking-wider mr-2 text-xs font-bold font-mono">Suffix Tag</span>
                                {system.systemTag}
                            </div>
                        )}
                    </div>
                    <p className="text-matrix-muted font-medium">This system has {system.members.length} registered members.</p>
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
                {system.list_privacy_enforced ? (
                    <div className="text-center py-20 space-y-4">
                        <div className="w-20 h-20 bg-matrix-light rounded-full flex items-center justify-center mx-auto text-red-500/80 opacity-80">
                            <Lock size={40} />
                        </div>
                        <h3 className="text-xl font-bold">Member list is private</h3>
                        <p className="text-matrix-muted max-w-xs mx-auto">This system has chosen not to display its members publicly.</p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            <AnimatePresence mode="popLayout">
                                {filteredMembers.map((member: any) => (
                                    <MemberCard 
                                        key={member.id} 
                                        member={member} 
                                        isReadOnly={true}
                                        isAutoproxy={system.autoproxyId === member.id}
                                        onEdit={(m) => setSelectedMember(m)}
                                        onDelete={() => {}}
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
                                <p className="text-matrix-muted max-w-xs mx-auto">Try a different search term.</p>
                            </div>
                        )}
                    </>
                )}
            </main>

            {/* Viewer Modal (Reusing MemberEditor in Read-Only mode) */}
            {selectedMember && (
                <MemberEditor 
                    member={selectedMember} 
                    isReadOnly={true}
                    onSave={() => {}}
                    onCancel={() => setSelectedMember(null)}
                />
            )}
        </div>
    );
};

export default PublicSystemPage;
