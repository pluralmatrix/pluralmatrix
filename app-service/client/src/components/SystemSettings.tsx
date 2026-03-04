import React, { useState, useEffect } from 'react';
import { X, Save, Settings, Hash, Link as LinkIcon, Trash2, Plus, AlertCircle, Star } from 'lucide-react';
import { systemService } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import DeadLetterQueue from './dlq/DeadLetterQueue';
import { Archive } from 'lucide-react';

interface SystemSettingsProps {
    onSave: (newSlug?: string) => void;
    onCancel: () => void;
}

const SystemSettings: React.FC<SystemSettingsProps> = ({ onSave, onCancel }) => {
    const { user } = useAuth();
    const [dlqOpen, setDlqOpen] = useState(false);
    const [dlqCount, setDlqCount] = useState(0);
    const [formData, setFormData] = useState({
        name: '',
        systemTag: '',
        slug: ''
    });
    const [links, setLinks] = useState<any[]>([]);
    const [newLinkMxid, setNewLinkMxid] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [linking, setLinking] = useState(false);

    const fetchLinks = async () => {
        try {
            const res = await systemService.getLinks();
            setLinks(res.data);
        } catch (err) {
            console.error('Failed to fetch links');
        }
    };

    useEffect(() => {
        const fetchSystem = async () => {
            try {
                const res = await systemService.get();
                setFormData({
                    name: res.data.name || '',
                    systemTag: res.data.systemTag || '',
                    slug: res.data.slug || ''
                });
                await fetchLinks();
                
                const dlqRes = await systemService.getDeadLetters();
                setDlqCount(dlqRes.data.length);
            } catch (err) {
                alert('Failed to load system settings.');
            } finally {
                setLoading(false);
            }
        };
        fetchSystem();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const res = await systemService.update(formData);
            onSave(res.data.slug);
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to save system settings.');
        } finally {
            setSaving(false);
        }
    };

    const handleAddLink = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newLinkMxid) return;
        setLinking(true);
        try {
            await systemService.createLink(newLinkMxid);
            setNewLinkMxid('');
            await fetchLinks();
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to link account.');
        } finally {
            setLinking(false);
        }
    };

    const handleSetPrimary = async (mxid: string) => {
        try {
            await systemService.setPrimaryLink(mxid);
            await fetchLinks();
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to set primary account.');
        }
    };

    const handleRemoveLink = async (mxid: string) => {
        // This case should theoretically not happen if the button is hidden, 
        // but kept for defense-in-depth.
        if (mxid.toLowerCase() === user?.mxid.toLowerCase()) {
            alert("You cannot unlink your primary account.");
            return;
        }

        if (confirm(`Are you sure you want to unlink ${mxid}?`)) {
            try {
                await systemService.deleteLink(mxid);
                await fetchLinks();
            } catch (err: any) {
                alert(err.response?.data?.error || 'Failed to unlink account.');
            }
        }
    };

    if (loading) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div className="max-w-2xl w-full bg-matrix-light border border-white/10 rounded-2xl shadow-2xl my-8">
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                        <div className="p-2 bg-matrix-primary/10 text-matrix-primary rounded-lg">
                            <Settings size={20} />
                        </div>
                        <h2 className="text-xl font-bold">System Settings</h2>
                    </div>
                    <button type="button" onClick={onCancel} className="p-2 hover:bg-white/5 rounded-full text-matrix-muted transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-12">
                    {/* Left: General Settings */}
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <h3 className="text-lg font-bold flex items-center gap-2">
                            General
                        </h3>
                        
                        <div>
                            <label className="block text-sm font-medium text-matrix-muted mb-1">System Name</label>
                            <input 
                                name="name"
                                className="matrix-input" 
                                value={formData.name} 
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })} 
                                placeholder="e.g. The Seraphim System"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-matrix-muted mb-1 flex items-center">
                                System Tag (Suffix)
                            </label>
                            <input 
                                className="matrix-input" 
                                value={formData.systemTag} 
                                onChange={(e) => setFormData({ ...formData, systemTag: e.target.value })} 
                                placeholder="e.g. ⛩️"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-matrix-muted mb-1 flex items-center">
                                System Slug
                                <Hash size={12} className="ml-1 text-matrix-primary" />
                            </label>
                            <input 
                                className="matrix-input font-mono text-sm" 
                                value={formData.slug} 
                                onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })} 
                                placeholder="e.g. seraphim"
                                required 
                            />
                            <p className="mt-1.5 text-[10px] text-matrix-muted">Ghost ID: @_plural_<b>{formData.slug || 'slug'}</b>_member:server</p>
                        </div>

                        <button type="submit" data-testid="save-system-settings-button" disabled={saving} className="matrix-button w-full flex items-center justify-center">
                            <Save size={18} className="mr-2" />
                            {saving ? 'Saving...' : 'Save General Settings'}
                        </button>
                    </form>

                    {/* Right: Account Links */}
                    <div className="space-y-6">
                        <h3 className="text-lg font-bold flex items-center gap-2">
                            Linked Accounts
                        </h3>

                        <div className="space-y-3">
                            {links.map((link) => {
                                const isSelf = link.matrixId.toLowerCase() === user?.mxid.toLowerCase();
                                return (
                                    <div key={link.matrixId} className={`flex items-center justify-between p-3 rounded-xl border group transition-all ${link.isPrimary ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-matrix-dark/50 border-white/5'}`}>
                                        <div className="flex items-center space-x-3 overflow-hidden">
                                            <div className={`p-2 rounded-lg ${link.isPrimary ? 'bg-yellow-500/20 text-yellow-500' : 'bg-matrix-primary/10 text-matrix-primary'}`}>
                                                {link.isPrimary ? <Star size={14} fill="currentColor" /> : <LinkIcon size={14} />}
                                            </div>
                                            <span className={`text-sm font-mono truncate ${link.isPrimary ? 'text-yellow-500 font-bold' : ''}`}>{link.matrixId}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {!link.isPrimary && (
                                                <button 
                                                    onClick={() => handleSetPrimary(link.matrixId)}
                                                    className="p-2 text-matrix-muted hover:text-yellow-500 transition-colors opacity-0 group-hover:opacity-100"
                                                    title="Set as Primary Routing Account"
                                                >
                                                    <Star size={16} />
                                                </button>
                                            )}
                                            {!isSelf && (
                                                <button 
                                                    onClick={() => handleRemoveLink(link.matrixId)}
                                                    className="p-2 text-matrix-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                                    title="Unlink Account"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <form onSubmit={handleAddLink} className="space-y-3 pt-4 border-t border-white/5">
                            <label className="block text-sm font-medium text-matrix-muted">Link New Account</label>
                            <div className="flex gap-2">
                                <input 
                                    className="matrix-input text-sm" 
                                    value={newLinkMxid} 
                                    onChange={(e) => setNewLinkMxid(e.target.value)} 
                                    placeholder="@user:server.com"
                                />
                                <button type="submit" disabled={linking || !newLinkMxid} className="matrix-button-outline px-3">
                                    <Plus size={20} />
                                </button>
                            </div>
                            <div className="flex items-start gap-2 p-3 bg-yellow-500/5 rounded-lg border border-yellow-500/10 text-[10px] text-yellow-500/80 leading-relaxed">
                                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                                <p>Target account must have zero members in its current system. Its old empty system will be deleted.</p>
                            </div>
                        </form>

                        {/* DLQ Button restored to original design but right-aligned */}
                        <div className="flex justify-end mt-4">
                            <button 
                                onClick={() => setDlqOpen(true)}
                                className="flex items-center gap-4 p-3 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-amber-500/30 rounded-2xl transition-all group text-left"
                            >
                                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 group-hover:scale-110 transition-transform">
                                    <Archive size={20} />
                                </div>
                                <div className="pr-4">
                                    <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                                        Delivery Recovery Vault
                                        {dlqCount > 0 && (
                                            <span className="bg-amber-500 text-slate-950 text-[9px] font-black px-1.5 py-0.5 rounded-full animate-pulse">
                                                {dlqCount} NEW
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Failed Messages</div>
                                </div>
                            </button>
                        </div>
                    </div>

                    <DeadLetterQueue 
                        isOpen={dlqOpen} 
                        onClose={() => setDlqOpen(false)} 
                        onCountChange={(count) => setDlqCount(count)}
                    />
                </div>
            </div>
        </div>
    );
};

export default SystemSettings;
