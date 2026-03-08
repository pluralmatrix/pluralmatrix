import React, { useState } from 'react';
import { X, Save, AlertCircle, Camera } from 'lucide-react';
import { groupService, memberService } from '../services/api';
import { getAvatarUrl } from '../utils/matrix';
import { validateAvatarImage } from '../utils/imageValidation';
import { useDirtyState } from '../hooks/useDirtyState';

interface GroupEditorProps {
    group?: any;
    systemMembers: any[];
    isReadOnly?: boolean;
    onSave: () => void;
    onCancel: () => void;
}

const GroupEditor: React.FC<GroupEditorProps> = ({ group, systemMembers, isReadOnly, onSave, onCancel }) => {
    const isNew = !group;
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const [formData, setFormData, isDirty] = useDirtyState({
        name: group?.name || '',
        displayName: group?.displayName || '',
        slug: group?.slug || '',
        description: group?.description || '',
        icon: group?.icon || '',
        color: group?.color || '',
        members: group?.members?.map((m: any) => typeof m === 'object' ? m.id : m) || []
    });

    const handleCancel = () => {
        if (!isReadOnly && isDirty) {
            if (window.confirm("You have unsaved changes. Are you sure you want to close without saving?")) {
                onCancel();
            }
        } else {
            onCancel();
        }
    };
    const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            
            setSaving(true);
            const validation = await validateAvatarImage(file);
            if (!validation.valid) {
                alert(validation.error);
                setSaving(false);
                return;
            }

            try {
                // Using memberService.uploadMedia here since media upload is generic 
                const res = await memberService.uploadMedia(file);
                setFormData({ ...formData, icon: res.data.content_uri });
            } catch (err) {
                alert('Icon upload failed.');
            } finally {
                setSaving(false);
            }
        }
    };

    const handleToggleMember = (memberId: string) => {
        setFormData(prev => {
            const exists = prev.members.includes(memberId);
            if (exists) {
                return { ...prev, members: prev.members.filter((id: string) => id !== memberId) };
            } else {
                return { ...prev, members: [...prev.members, memberId] };
            }
        });
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError('');

        try {
            const payload = {
                name: formData.name,
                displayName: formData.displayName || null,
                slug: formData.slug || formData.name.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                description: formData.description || null,
                icon: formData.icon || null,
                color: formData.color || null,
                members: formData.members
            };

            if (isNew) {
                await groupService.create(payload);
            } else {
                await groupService.update(group.id, payload);
            }
            onSave();
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to save group.');
        } finally {
            setSaving(false);
        }
    };

    if (isReadOnly) {
        return (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                <div className="bg-matrix-light rounded-3xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold text-white">{group.displayName || group.name}</h2>
                        <button onClick={onCancel} className="p-2 hover:bg-white/5 rounded-full text-matrix-muted"><X /></button>
                    </div>
                    <div className="space-y-4">
                        {group.description && <p className="text-matrix-muted">{group.description}</p>}
                        <h3 className="text-lg font-bold mt-4">Members</h3>
                        <div className="flex flex-wrap gap-2">
                            {systemMembers.filter(m => (formData.members as string[]).includes(m.id)).map(m => (
                                <span key={m.id} className="bg-matrix-dark px-3 py-1 rounded-full text-sm font-medium border border-white/5">
                                    {m.name}
                                </span>
                            ))}
                            {formData.members.length === 0 && <span className="text-matrix-muted italic">No members in this group.</span>}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-matrix-light rounded-3xl p-6 w-full max-w-2xl my-8 border border-white/10 shadow-2xl relative">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-white">{isNew ? 'Create Group' : 'Edit Group'}</h2>
                    <button onClick={handleCancel} className="p-2 hover:bg-white/5 rounded-full text-matrix-muted"><X /></button>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start text-red-400">
                        <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0 mt-0.5" />
                        <div>
                            <div className="font-bold">Error</div>
                            <div className="text-sm">{error}</div>
                        </div>
                    </div>
                )}

                <form onSubmit={handleSave} className="space-y-6">
                    <div className="flex flex-col md:flex-row gap-8 items-start">
                        <div className="space-y-4 flex-shrink-0 mx-auto md:mx-0 w-32 relative group">
                            <div className="relative w-32 h-32 rounded-3xl overflow-hidden bg-matrix-dark border-2 border-white/5 shadow-inner">
                                {formData.icon && getAvatarUrl(formData.icon) ? (
                                    <img src={getAvatarUrl(formData.icon)!} className="w-full h-full object-cover" alt="Icon" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-matrix-muted">
                                        <Camera size={40} />
                                    </div>
                                )}
                                {!isReadOnly && (
                                    <label className="absolute -inset-1 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                        <Camera className="text-white" size={24} />
                                        <input data-testid="icon-upload-input" type="file" accept=".jpg,.jpeg,.png,.webp" onChange={handleIconUpload} className="hidden" />
                                    </label>
                                )}
                            </div>
                            {!isReadOnly && formData.icon && (
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, icon: '' })}
                                    className="absolute -top-2 -right-2 p-1.5 bg-matrix-dark/80 backdrop-blur-md border border-white/10 hover:bg-red-500/80 text-matrix-muted hover:text-white rounded-full shadow-lg transition-all z-10 opacity-0 group-hover:opacity-100"
                                    title="Clear Icon"
                                >
                                    <X size={14} />
                                </button>
                            )}

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
                                <div>
                                    <label className="block text-xs font-bold text-matrix-muted uppercase tracking-wider mb-1">Internal Name <span className="text-red-400">*</span></label>
                                    <input
                                        required
                                        name="group-name"
                                        className="matrix-input w-full"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-matrix-muted uppercase tracking-wider mb-1">Display Name</label>
                                    <input
                                        name="group-display-name"
                                        className="matrix-input w-full"
                                        value={formData.displayName}
                                        onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-matrix-muted uppercase tracking-wider mb-1">Slug (ID) <span className="font-normal opacity-50 ml-1">Optional</span></label>
                                    <input
                                        name="group-slug"
                                        className="matrix-input w-full"
                                        value={formData.slug}
                                        onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                                        placeholder={formData.name ? formData.name.toLowerCase().replace(/[^a-z0-9-]/g, '') : ''}
                                    />
                                </div>
                            </div>
                            
                            <div>
                                <label className="block text-xs font-bold text-matrix-muted uppercase tracking-wider mb-1">Description</label>
                                <textarea
                                    name="group-description"
                                    className="matrix-input w-full h-24 resize-none"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                />
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold mb-2">Group Members</label>
                        {systemMembers.length > 0 ? (
                            <div className="flex flex-wrap gap-2 bg-matrix-dark/30 p-4 rounded-xl border border-white/5">
                                {systemMembers.sort((a, b) => a.name.localeCompare(b.name)).map(member => {
                                    const isSelected = formData.members.includes(member.id);
                                    const testId = member.name ? `toggle-member-${member.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}` : '';
                                    return (
                                        <button
                                            key={member.id}
                                            type="button"
                                            data-testid={testId}
                                            onClick={() => handleToggleMember(member.id)}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                                                isSelected 
                                                    ? 'bg-matrix-primary text-white border-matrix-primary shadow-md shadow-matrix-primary/20' 
                                                    : 'bg-white/5 text-matrix-muted border-white/10 hover:bg-white/10 hover:text-white'
                                            }`}
                                        >
                                            {member.name}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="text-matrix-muted text-sm italic bg-matrix-dark/30 p-4 rounded-xl border border-white/5">
                                No system members available. Create members first to add them to groups.
                            </div>
                        )}
                    </div>

                    <div className="pt-4 flex justify-end space-x-3 border-t border-white/5">
                        <button
                            type="button"
                            data-testid="cancel-group-button"
                            onClick={handleCancel}
                            disabled={saving}
                            className="px-6 py-2.5 rounded-xl font-bold text-matrix-muted hover:text-white hover:bg-white/5 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            data-testid="save-group-button"
                            disabled={saving}
                            className="matrix-button flex items-center shadow-lg shadow-matrix-primary/20"
                        >
                            {saving ? 'Saving...' : <><Save size={18} className="mr-2" /> Save Group</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default GroupEditor;
