import React from 'react';
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
    return (
        <motion.div 
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            data-testid={`group-card-${group.slug}`}
            className={`bg-matrix-light p-5 rounded-2xl border border-white/5 relative overflow-hidden group shadow-lg`}
        >
            <div className="flex items-start space-x-4 relative z-10">
                <div className="relative">
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
                        <h3 className="font-bold text-lg truncate group-hover:text-matrix-primary transition-colors">
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

            {/* Action Buttons Overlay */}
            {!isReadOnly && (
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1 z-20">
                    <button 
                        onClick={() => onEdit?.(group)}
                        data-testid={`edit-group-${group.slug}`}
                        className="p-1.5 bg-matrix-dark hover:bg-matrix-primary text-white rounded-md shadow-lg transition-colors"
                        title="Edit Group"
                    >
                        <Edit2 size={14} />
                    </button>
                    <button 
                        onClick={() => onDelete?.(group.id)}
                        data-testid={`delete-group-${group.slug}`}
                        className="p-1.5 bg-matrix-dark hover:bg-red-500 text-white rounded-md shadow-lg transition-colors"
                        title="Delete Group"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            )}
        </motion.div>
    );
};

export default GroupCard;
