import React, { useState, useEffect } from 'react';
import { Trash2, AlertTriangle, RefreshCw, MessageSquare, Info, X, Copy, Check } from 'lucide-react';
import { systemService } from '../../services/api';

interface DeadLetter {
    id: string;
    timestamp: number;
    roomId: string;
    ghostUserId: string;
    plaintext: string;
    errorReason: string;
}

interface DeadLetterQueueProps {
    isOpen: boolean;
    onClose: () => void;
    onCountChange?: (count: number) => void;
}

const DeadLetterQueue: React.FC<DeadLetterQueueProps> = ({ isOpen, onClose, onCountChange }) => {
    const [letters, setLetters] = useState<DeadLetter[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedLetter, setSelectedLetter] = useState<DeadLetter | null>(null);
    const [copied, setCopied] = useState(false);

    const fetchDeadLetters = async () => {
        setLoading(true);
        try {
            const response = await systemService.getDeadLetters();
            const sorted = response.data.sort((a: DeadLetter, b: DeadLetter) => b.timestamp - a.timestamp);
            setLetters(sorted);
            if (onCountChange) onCountChange(sorted.length);
        } catch (err) {
            console.error('Failed to fetch dead letters');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) fetchDeadLetters();
    }, [isOpen]);

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        try {
            await systemService.deleteDeadLetter(id);
            const remaining = letters.filter(l => l.id !== id);
            setLetters(remaining);
            if (onCountChange) onCountChange(remaining.length);
            if (selectedLetter?.id === id) setSelectedLetter(null);
        } catch (err) {
            alert('Failed to delete item');
        }
    };

    const handleCopy = () => {
        if (!selectedLetter) return;
        navigator.clipboard.writeText(selectedLetter.plaintext);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 w-full max-w-2xl max-h-[80vh] rounded-2xl border border-slate-800 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="text-amber-500" size={20} />
                        <h2 className="text-lg font-bold text-slate-100" data-testid="dlq-modal-title">Dead Letter Vault</h2>
                        <span className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full">
                            {letters.length}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={fetchDeadLetters}
                            data-testid="dlq-refresh-button"
                            className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-slate-100 transition-colors"
                            disabled={loading}
                        >
                            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
                        </button>
                        <button onClick={onClose} data-testid="dlq-close-button" className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-slate-100 transition-colors">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* List View */}
                <div className="flex-1 overflow-y-auto p-2">
                    {letters.length === 0 ? (
                        <div className="flex flex-col items-center py-16 text-slate-500 italic" data-testid="dlq-empty-state">
                            <Info size={48} className="mb-4 opacity-10" />
                            <p>Vault is empty.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-800/50">
                            {letters.map((letter) => (
                                <button 
                                    key={letter.id}
                                    data-testid={`dlq-item-${letter.id}`}
                                    onClick={() => setSelectedLetter(letter)}
                                    className="w-full text-left p-3 hover:bg-slate-800/50 rounded-xl transition-all flex items-center gap-4 group"
                                >
                                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0 group-hover:bg-amber-500/20 transition-colors">
                                        <MessageSquare size={16} className="text-amber-500" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className="text-xs font-mono text-slate-500 truncate max-w-[150px]">
                                                {new Date(letter.timestamp).toLocaleTimeString()}
                                            </span>
                                            <span className="text-[10px] uppercase font-bold tracking-wider text-red-400/80 truncate">
                                                {letter.errorReason.split(':')[0]}
                                            </span>
                                        </div>
                                        <p className="text-slate-300 text-sm truncate font-medium">
                                            {letter.plaintext}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button 
                                            onClick={(e) => handleDelete(e, letter.id)}
                                            data-testid={`dlq-delete-${letter.id}`}
                                            className="p-2 hover:bg-red-500/20 text-slate-500 hover:text-red-400 rounded-lg transition-all"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-3 bg-slate-950/30 text-[10px] text-slate-500 text-center border-t border-slate-800/50">
                    Messages are automatically purged from the vault after 24 hours.
                </div>
            </div>

            {/* Detail Modal */}
            {selectedLetter && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-150">
                    <div className="bg-slate-800 w-full max-w-lg rounded-2xl border border-slate-700 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
                        <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-900/50">
                            <h3 className="font-bold text-slate-100">Message Recovery</h3>
                            <button onClick={() => setSelectedLetter(null)} className="p-1 hover:bg-slate-700 rounded-lg text-slate-400">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Original Content</label>
                                <div className="relative group">
                                    <textarea 
                                        readOnly
                                        rows={6}
                                        className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-slate-200 font-mono resize-none focus:outline-none"
                                        value={selectedLetter.plaintext}
                                    />
                                    <button 
                                        onClick={handleCopy}
                                        className="absolute top-2 right-2 p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-600 shadow-lg transition-all flex items-center gap-2 text-xs"
                                    >
                                        {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                                        {copied ? "Copied!" : "Copy Text"}
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-700/50">
                                    <span className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Target Ghost</span>
                                    <span className="text-xs text-purple-300 font-mono break-all">{selectedLetter.ghostUserId}</span>
                                </div>
                                <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-700/50">
                                    <span className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Room ID</span>
                                    <span className="text-xs text-slate-300 font-mono break-all">{selectedLetter.roomId}</span>
                                </div>
                            </div>

                            <div className="bg-red-500/5 border border-red-500/10 p-3 rounded-xl">
                                <span className="block text-[9px] font-bold text-red-400/60 uppercase mb-1">Error Trace</span>
                                <span className="text-xs text-red-300/90 leading-relaxed italic">{selectedLetter.errorReason}</span>
                            </div>
                        </div>
                        <div className="p-4 bg-slate-900/50 flex justify-end">
                            <button 
                                onClick={() => setSelectedLetter(null)}
                                className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold transition-all"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DeadLetterQueue;
