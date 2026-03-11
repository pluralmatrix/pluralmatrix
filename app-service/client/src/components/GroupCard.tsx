import React, { useRef, useState } from 'react';
import { Edit2, Trash2, Users } from 'lucide-react';
import { motion } from 'framer-motion';
import { getAvatarUrl } from '../utils/matrix';

interface GroupCardProps {
    group: any;
    isReadOnly?: boolean;
    onEdit?: (group: any) => void;
    onDelete?: (id: string) => void;
}

const GroupCard: React.FC<GroupCardProps> = ({ group, isReadOnly, onEdit, onDelete }) => {
    const nameRef = useRef<HTMLHeadingElement>(null);
    const [isTruncated, setIsTruncated] = useState(false);

    const handleMouseEnter = () => {
        if (nameRef.current) {
            setIsTruncated(nameRef.current.scrollWidth > nameRef.current.clientWidth);
        }
    };

    return (
        <motion.div 
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            data-testid={`group-card-${group.slug}`}
            className="group bg-matrix-light rounded-2xl border border-white/5 shadow-lg overflow-hidden transition-all hover:border-matrix-primary/30"
        >
            <div className="p-4 sm:p-6">
                <div className="flex justify-between items-start gap-4">
                    <div className="flex items-start space-x-4 min-w-0">
                        <div className="relative flex-shrink-0">
                            {group.icon ? (
                                <img 
                                    src={getAvatarUrl(group.icon)!} 
                                    alt={group.name} 
                                    className="w-16 h-16 rounded-xl object-cover shadow-md"
                                />
                            ) : (
                                <div className="w-16 h-16 bg-matrix-dark rounded-xl flex items-center justify-center text-matrix-muted shadow-inner">
                                    <Users size={24} />
                                </div>
                            )}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                                <h3 
                                    ref={nameRef}
                                    onMouseEnter={handleMouseEnter}
                                    className="font-bold text-lg truncate group-hover:text-matrix-primary transition-colors" 
                                    title={isTruncated ? (group.displayName || group.name) : undefined}
                                >
                                    {group.displayName || group.name}
                                </h3>
                            </div>
                            
                            <div className="text-sm text-matrix-muted space-y-1">
                                <div className="flex items-center space-x-2">
                                    <span className="font-mono text-xs bg-black/20 px-2 py-0.5 rounded border border-white/5 truncate">
                                        {group.slug}
                                    </span>
                                </div>
                                {group.description && (
                                    <p className="text-xs text-matrix-muted/80 line-clamp-2 mt-1 italic">
                                        {group.description}
                                    </p>
                                )}
                                <div className="text-xs mt-2 font-medium">
                                    {group.members?.length || 0} Member{(group.members?.length !== 1) ? 's' : ''}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    {!isReadOnly && (
                        <div className="flex flex-col space-y-2 opacity-100 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 transition-opacity flex-shrink-0">
                            <button 
                                onClick={() => onEdit?.(group)}
                                data-testid={`edit-group-${group.slug}`}
                                className="p-2 hover:bg-white/5 rounded-lg text-matrix-muted hover:text-white transition-colors"
                                title="Edit Group"
                            >
                                <Edit2 size={18} />
                            </button>
                            <button 
                                onClick={() => onDelete?.(group.id)}
                                data-testid={`delete-group-${group.slug}`}
                                className="p-2 hover:bg-red-500/20 rounded-lg text-matrix-muted hover:text-red-400 transition-colors"
                                title="Delete Group"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
};

export default GroupCard;
