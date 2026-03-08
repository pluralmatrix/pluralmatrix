import React, { useState, useRef, useEffect } from 'react';
import { Globe, Lock } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

interface PrivacyToggleProps {
    value?: 'public' | 'private';
    onChange: (val: 'public' | 'private') => void;
    className?: string;
}

const PrivacyToggle: React.FC<PrivacyToggleProps> = ({ value = 'public', onChange, className = '' }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const isPrivate = value === 'private';

    return (
        <div className={`relative inline-flex items-center ${className}`} ref={containerRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`p-1.5 rounded-md transition-colors ${
                    isPrivate 
                        ? 'text-red-400 hover:bg-red-400/10' 
                        : 'text-matrix-muted hover:text-white hover:bg-white/10'
                }`}
                title={isPrivate ? 'Private' : 'Public'}
            >
                {isPrivate ? <Lock size={16} /> : <Globe size={16} />}
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -5, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -5, scale: 0.95 }}
                        transition={{ duration: 0.1 }}
                        className="absolute left-0 top-full mt-1 w-32 bg-matrix-light border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden"
                    >
                        <button
                            type="button"
                            onClick={() => { onChange('public'); setIsOpen(false); }}
                            className={`w-full flex items-center px-3 py-2 text-sm text-left transition-colors ${
                                !isPrivate ? 'bg-matrix-primary/20 text-matrix-primary' : 'text-matrix-text hover:bg-white/5'
                            }`}
                        >
                            <Globe size={14} className="mr-2" /> Public
                        </button>
                        <button
                            type="button"
                            onClick={() => { onChange('private'); setIsOpen(false); }}
                            className={`w-full flex items-center px-3 py-2 text-sm text-left transition-colors ${
                                isPrivate ? 'bg-red-500/20 text-red-400' : 'text-matrix-text hover:bg-white/5'
                            }`}
                        >
                            <Lock size={14} className="mr-2" /> Private
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default PrivacyToggle;
