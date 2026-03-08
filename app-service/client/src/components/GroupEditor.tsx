import React, { useState } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
import { groupService } from '../services/api';

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
    
    const [formData, setFormData] = useState({
        name: group?.name || '',
        displayName: group?.displayName || '',
        slug: group?.slug || '',
        description: group?.description || '',
        icon: group?.icon || '',
        color: group?.color || '',
        members: group?.members?.map((m: any) => typeof m === 'object' ? m.id : m) || []
    });

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
                    <button onClick={onCancel} className="p-2 hover:bg-white/5 rounded-full text-matrix-muted"><X /></button>
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-bold mb-2">Internal Name <span className="text-red-400">*</span></label>
                            <input
                                required
                                name="group-name"
                                className="matrix-input w-full"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold mb-2">Display Name</label>
                            <input
                                name="group-display-name"
                                className="matrix-input w-full"
                                value={formData.displayName}
                                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-bold mb-2">Slug (ID) <span className="text-matrix-muted font-normal ml-2">Optional</span></label>
                            <input
                                name="group-slug"
                                className="matrix-input w-full"
                                value={formData.slug}
                                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                                placeholder={formData.name ? formData.name.toLowerCase().replace(/[^a-z0-9-]/g, '') : ''}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold mb-2">Color (Hex) <span className="text-matrix-muted font-normal ml-2">Optional</span></label>
                            <div className="flex items-center space-x-2">
                                <span className="text-matrix-muted font-mono">#</span>
                                <input
                                    name="group-color"
                                    className="matrix-input flex-1 font-mono uppercase"
                                    value={formData.color}
                                    maxLength={6}
                                    placeholder="8F00FF"
                                    onChange={(e) => setFormData({ ...formData, color: e.target.value.replace(/[^0-9A-Fa-f]/g, '') })}
                                />
                                {formData.color && formData.color.length === 6 && (
                                    <div className="w-8 h-8 rounded-lg shadow-inner" style={{ backgroundColor: `#${formData.color}` }} />
                                )}
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold mb-2">Description</label>
                        <textarea
                            name="group-description"
                            className="matrix-input w-full h-24 resize-none"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-bold mb-2">Icon URL (mxc://)</label>
                        <input
                            name="group-icon"
                            className="matrix-input w-full"
                            value={formData.icon}
                            onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                            placeholder="mxc://server.name/abc123def456"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-bold mb-2">Group Members</label>
                        {systemMembers.length > 0 ? (
                            <div className="flex flex-wrap gap-2 bg-matrix-dark/30 p-4 rounded-xl border border-white/5">
                                {systemMembers.sort((a, b) => a.name.localeCompare(b.name)).map(member => {
                                    const isSelected = formData.members.includes(member.id);
                                    return (
                                        <button
                                            key={member.id}
                                            type="button"
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
                            onClick={onCancel}
                            disabled={saving}
                            className="px-6 py-2.5 rounded-xl font-bold text-matrix-muted hover:text-white hover:bg-white/5 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
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
