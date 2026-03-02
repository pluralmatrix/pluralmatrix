import React, { useState, useRef, useEffect } from 'react';
import { X, Save, Plus, Trash2, Camera } from 'lucide-react';
import { memberService } from '../services/api';
import { getAvatarUrl } from '../utils/matrix';
import { validateAvatarImage } from '../utils/imageValidation';

interface MemberEditorProps {
    member?: any;
    isReadOnly?: boolean;
    onSave: () => void;
    onCancel: () => void;
}

const MemberEditor: React.FC<MemberEditorProps> = ({ member, isReadOnly, onSave, onCancel }) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [formData, setFormData] = useState({
        slug: member?.slug || '',
        name: member?.name || '',
        displayName: member?.displayName || '',
        pronouns: member?.pronouns || '',
        description: member?.description || '',
        color: member?.color || '0dbd8b',
        avatarUrl: member?.avatarUrl || '',
        proxyTags: member?.proxyTags || [{ prefix: '', suffix: '' }]
    });
    const [loading, setLoading] = useState(false);

    const handleAddTag = () => {
        setFormData({ ...formData, proxyTags: [...formData.proxyTags, { prefix: '', suffix: '' }] });
    };

    const handleRemoveTag = (index: number) => {
        const newTags = formData.proxyTags.filter((_: any, i: number) => i !== index);
        setFormData({ ...formData, proxyTags: newTags });
    };

    const handleTagChange = (index: number, field: string, value: string) => {
        const newTags = [...formData.proxyTags];
        newTags[index][field] = value;
        setFormData({ ...formData, proxyTags: newTags });
    };

    // Auto-expand description textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [formData.description]);

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            
            // 1. Client-side validation
            setLoading(true);
            const validation = await validateAvatarImage(file);
            if (!validation.valid) {
                alert(validation.error);
                setLoading(false);
                return;
            }

            try {
                const res = await memberService.uploadMedia(file);
                setFormData({ ...formData, avatarUrl: res.data.content_uri });
            } catch (err) {
                alert('Avatar upload failed.');
            } finally {
                setLoading(false);
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        // Basic validation for proxy tags
        const validTags = formData.proxyTags.filter((t: any) => t.prefix.trim().length > 0);
        if (validTags.length === 0) {
            alert('At least one proxy tag with a prefix is required.');
            return;
        }

        // Check for duplicates within the current member
        const tagCombos = new Set();
        for (const tag of validTags) {
            const combo = `${tag.prefix}|${tag.suffix || ''}`;
            if (tagCombos.has(combo)) {
                alert(`Duplicate proxy tag found: "${tag.prefix}...${tag.suffix || ''}"`);
                return;
            }
            tagCombos.add(combo);
        }

        setLoading(true);
        try {
            const dataToSave = {
                ...formData,
                proxyTags: validTags
            };

            if (member?.id) {
                await memberService.update(member.id, dataToSave);
            } else {
                await memberService.create(dataToSave);
            }
            onSave();
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to save member.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div className="max-w-2xl w-full bg-matrix-light border border-white/10 rounded-2xl shadow-2xl my-8">
                <form onSubmit={isReadOnly ? (e) => e.preventDefault() : handleSubmit}>
                    <div className="p-6 border-b border-white/5 flex items-center justify-between">
                        <h2 className="text-2xl font-bold">
                            {isReadOnly ? 'System Member Profile' : (member ? 'Edit System Member' : 'New System Member')}
                        </h2>
                        <button type="button" onClick={onCancel} className="p-2 hover:bg-white/5 rounded-full text-matrix-muted transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="p-8 space-y-8 text-slate-200">
                        {/* Avatar & Basic Info */}
                        <div className="flex flex-col md:flex-row gap-8 items-start">
                            <div className="space-y-4 flex-shrink-0 mx-auto md:mx-0 w-32">
                                <div className="relative group w-32 h-32 rounded-3xl overflow-hidden bg-matrix-dark border-2 border-white/5 shadow-inner">
                                    {formData.avatarUrl && getAvatarUrl(formData.avatarUrl) ? (
                                        <img src={getAvatarUrl(formData.avatarUrl)!} className="w-full h-full object-cover" alt="Avatar" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-matrix-muted">
                                            <Camera size={40} />
                                        </div>
                                    )}
                                    {!isReadOnly && (
                                        <label className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-3xl">
                                            <Camera className="text-white" size={24} />
                                            <input type="file" accept=".jpg,.jpeg,.png,.webp" onChange={handleAvatarUpload} className="hidden" />
                                        </label>
                                    )}
                                </div>

                                {/* Theme Color */}
                                <div className="space-y-1">
                                    <label className="block text-[10px] font-bold text-matrix-muted uppercase tracking-widest">Theme Color</label>
                                    <div className="flex items-center space-x-2">
                                        {isReadOnly ? (
                                            <div 
                                                className="w-8 h-8 rounded-lg border border-white/10 shadow-inner"
                                                style={{ backgroundColor: `#${formData.color.replace('#', '')}` }}
                                            />
                                        ) : (
                                            <input 
                                                type="color" 
                                                value={`#${formData.color.replace('#', '')}`}
                                                onChange={(e) => setFormData({ ...formData, color: e.target.value.replace('#', '') })}
                                                className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border border-white/10 overflow-hidden shadow-inner p-0"
                                            />
                                        )}
                                        <span className="text-xs font-mono text-slate-400">#{formData.color.toUpperCase()}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 space-y-4 w-full">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="block text-xs font-bold text-matrix-muted uppercase tracking-wider">Name</label>
                                        {isReadOnly ? (
                                            <div className="p-3 bg-matrix-dark rounded-xl border border-white/5 text-sm">{formData.name}</div>
                                        ) : (
                                            <input 
                                                className="matrix-input text-sm" 
                                                value={formData.name} 
                                                onChange={(e) => setFormData({ ...formData, name: e.target.value })} 
                                                placeholder="e.g. Alice"
                                                required 
                                            />
                                        )}
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-xs font-bold text-matrix-muted uppercase tracking-wider">Display Name</label>
                                        {isReadOnly ? (
                                            <div className="p-3 bg-matrix-dark rounded-xl border border-white/5 text-sm">{formData.displayName || 'None'}</div>
                                        ) : (
                                            <input 
                                                className="matrix-input text-sm" 
                                                value={formData.displayName} 
                                                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })} 
                                                placeholder=""
                                            />
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="block text-xs font-bold text-matrix-muted uppercase tracking-wider">Short ID (Slug)</label>
                                        {isReadOnly ? (
                                            <div className="p-3 bg-matrix-dark rounded-xl border border-white/5 text-sm font-mono">{formData.slug}</div>
                                        ) : (
                                            <input 
                                                className="matrix-input text-sm font-mono" 
                                                value={formData.slug} 
                                                onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })} 
                                                placeholder="e.g. alice"
                                                required 
                                            />
                                        )}
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-xs font-bold text-matrix-muted uppercase tracking-wider">Pronouns</label>
                                        {isReadOnly ? (
                                            <div className="p-3 bg-matrix-dark rounded-xl border border-white/5 text-sm">{formData.pronouns || 'None'}</div>
                                        ) : (
                                            <input 
                                                className="matrix-input text-sm" 
                                                value={formData.pronouns} 
                                                onChange={(e) => setFormData({ ...formData, pronouns: e.target.value })} 
                                                placeholder="e.g. she/her"
                                            />
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Description */}
                        <div className="space-y-1">
                            <label className="block text-xs font-bold text-matrix-muted uppercase tracking-wider">Description</label>
                            {isReadOnly ? (
                                <div className="p-4 bg-matrix-dark rounded-xl border border-white/5 text-sm whitespace-pre-wrap min-h-[150px] italic text-slate-300 font-sans">
                                    {formData.description || 'No description provided.'}
                                </div>
                            ) : (
                                <textarea 
                                    ref={textareaRef}
                                    className="matrix-input text-sm min-h-[150px] py-3 overflow-hidden resize-none" 
                                    value={formData.description} 
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })} 
                                    placeholder="Tell us about this system member..."
                                />
                            )}
                        </div>

                        {/* Proxy Tags */}
                        <div className="space-y-3 pt-4 border-t border-white/5">
                            <div className="flex items-center justify-between">
                                <label className="block text-xs font-bold text-matrix-muted uppercase tracking-wider">Proxy Tags</label>
                                {!isReadOnly && (
                                    <button type="button" onClick={handleAddTag} className="text-matrix-primary hover:text-matrix-primary/80 transition-colors flex items-center text-[10px] font-bold uppercase tracking-widest">
                                        <Plus size={14} className="mr-1" /> Add Tag
                                    </button>
                                )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {formData.proxyTags.map((tag: any, index: number) => (
                                    <div key={index} className="flex items-center gap-2 bg-matrix-dark/50 p-2 rounded-xl border border-white/5 group">
                                        <input 
                                            className="bg-matrix-dark border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono w-full focus:outline-none focus:border-matrix-primary transition-colors disabled:opacity-50" 
                                            value={tag.prefix} 
                                            disabled={isReadOnly}
                                            onChange={(e) => handleTagChange(index, 'prefix', e.target.value)}
                                            placeholder="prefix"
                                        />
                                        <span className="text-matrix-muted text-xs font-mono px-1 opacity-50">...</span>
                                        <input 
                                            className="bg-matrix-dark border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono w-full focus:outline-none focus:border-matrix-primary transition-colors disabled:opacity-50" 
                                            value={tag.suffix} 
                                            disabled={isReadOnly}
                                            onChange={(e) => handleTagChange(index, 'suffix', e.target.value)}
                                            placeholder="suffix"
                                        />
                                        {!isReadOnly && formData.proxyTags.length > 1 && (
                                            <button type="button" onClick={() => handleRemoveTag(index)} className="p-1.5 text-matrix-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
                                                <Trash2 size={14} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="p-6 border-t border-white/5 bg-matrix-dark/30 flex justify-end gap-3 rounded-b-2xl">
                        <button type="button" onClick={onCancel} className="px-6 py-2 rounded-xl text-sm font-bold text-matrix-muted hover:text-white hover:bg-white/5 transition-all">
                            {isReadOnly ? 'Close' : 'Cancel'}
                        </button>
                        {!isReadOnly && (
                            <button type="submit" disabled={loading} className="matrix-button flex items-center px-8">
                                <Save size={18} className="mr-2" />
                                {loading ? 'Saving...' : 'Save Member'}
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
};

export default MemberEditor;
