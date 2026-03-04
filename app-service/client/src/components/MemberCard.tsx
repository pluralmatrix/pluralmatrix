import React from 'react';
import { motion } from 'framer-motion';
import { User, MessageSquare, Info, Trash2, Edit3, Star } from 'lucide-react';
import { getAvatarUrl } from '../utils/matrix';

interface Member {
    id: string;
    slug: string;
    name: string;
    displayName: string | null;
    avatarUrl: string | null;
    pronouns: string | null;
    description: string | null;
    color: string | null;
    proxyTags: any[];
}

interface MemberCardProps {
    member: Member;
    isAutoproxy?: boolean;
    isReadOnly?: boolean;
    onEdit: (member: Member) => void;
    onDelete: (id: string) => void;
    onToggleAutoproxy?: (id: string) => void;
}

const MemberCard: React.FC<MemberCardProps> = ({ member, isAutoproxy, isReadOnly, onEdit, onDelete, onToggleAutoproxy }) => {
    return (
        <motion.div 
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`matrix-card group ${isAutoproxy ? 'ring-2 ring-yellow-500/50 shadow-lg shadow-yellow-500/10' : ''}`}
            onClick={() => isReadOnly && onEdit(member)}
        >
            <div 
                className="h-2 w-full" 
                style={{ backgroundColor: member.color ? `#${member.color}` : '#0dbd8b' }} 
            />
            <div className="p-6 space-y-4">
                <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-4">
                        <div className="relative w-16 h-16 rounded-2xl overflow-hidden bg-matrix-dark border border-white/5 flex-shrink-0">
                            {member.avatarUrl && getAvatarUrl(member.avatarUrl) ? (
                                <img 
                                    data-testid="member-avatar"
                                    src={getAvatarUrl(member.avatarUrl)!} 
                                    alt={member.name}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-matrix-muted">
                                    <User size={32} />
                                </div>
                            )}
                        </div>
                        <div>
                            <h3 data-testid="member-card-name" className="text-xl font-bold flex items-center gap-2">
                                {member.displayName || member.name}
                                {isAutoproxy && <span className="bg-yellow-500/20 text-yellow-500 text-[10px] uppercase font-bold px-2 py-0.5 rounded flex items-center gap-1"><Star size={10} fill="currentColor"/> Autoproxy</span>}
                            </h3>
                            <p className="text-matrix-muted text-xs font-mono">{member.slug}</p>
                            {member.pronouns && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-matrix-primary/10 text-matrix-primary mt-1 inline-block">
                                    {member.pronouns}
                                </span>
                            )}
                        </div>
                    </div>
                    {!isReadOnly && (
                        <div className="flex flex-col space-y-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                                data-testid={`toggle-autoproxy-${member.slug}`}
                                onClick={() => onToggleAutoproxy?.(member.id)}
                                className={`p-2 rounded-lg transition-colors ${isAutoproxy ? 'bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30' : 'hover:bg-white/5 text-matrix-muted hover:text-yellow-500'}`}
                                title={isAutoproxy ? "Disable Autoproxy" : "Set as Autoproxy"}
                            >
                                <Star size={18} fill={isAutoproxy ? "currentColor" : "none"} />
                            </button>
                            <button 
                                onClick={() => onEdit(member)}
                                className="p-2 hover:bg-white/5 rounded-lg text-matrix-muted hover:text-white transition-colors"
                                aria-label={`Edit Member ${member.name}`}
                            >
                                <Edit3 size={18} />
                            </button>
                            <button 
                                data-testid={`delete-member-${member.slug}`}
                                onClick={() => onDelete(member.id)}
                                className="p-2 hover:bg-red-400/10 rounded-lg text-matrix-muted hover:text-red-400 transition-colors"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>
                    )}
                </div>

                <div className="space-y-3">
                    <div className="flex items-center space-x-2 text-sm text-matrix-muted">
                        <MessageSquare size={14} />
                        <span className="flex-1 truncate">
                            {member.proxyTags && (member.proxyTags as any[]).length > 0 ? (
                                (member.proxyTags as any[]).map(t => `"${t.prefix} ...${t.suffix || ""}"`).join(", ")
                            ) : "No tags"}
                        </span>
                    </div>
                    {member.description && (
                        <div className="flex items-start space-x-2 text-sm text-matrix-muted">
                            <Info size={14} className="mt-1 flex-shrink-0" />
                            <p className="line-clamp-2 italic">{member.description}</p>
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
};

export default MemberCard;
