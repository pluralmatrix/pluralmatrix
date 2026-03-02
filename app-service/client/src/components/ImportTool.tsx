import React, { useState } from 'react';
import { Upload, X, CheckCircle2, AlertCircle, FileJson, Archive } from 'lucide-react';
import { memberService } from '../services/api';

interface ImportToolProps {
    onComplete: (newSlug?: string) => void;
    onCancel: () => void;
}

const ImportTool: React.FC<ImportToolProps> = ({ onComplete, onCancel }) => {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [error, setError] = useState('');
    const [count, setCount] = useState(0);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const handleImport = async () => {
        if (!file) return;
        setStatus('loading');
        try {
            if (file.name.endsWith('.json')) {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        const json = JSON.parse(e.target?.result as string);
                        const res = await memberService.importPkJson(json);
                        setCount(res.data.count);
                        setStatus('success');
                        setTimeout(() => onComplete(res.data.systemSlug), 2000);
                    } catch (err: any) {
                        setError('Invalid JSON file or server error.');
                        setStatus('error');
                    }
                };
                reader.readAsText(file);
            } else if (file.name.endsWith('.zip')) {
                try {
                    const res = await memberService.importBackupZip(file);
                    setCount(res.data.count);
                    setStatus('success');
                    setTimeout(() => onComplete(res.data.systemSlug), 2000);
                } catch (err: any) {
                    setError('Failed to process ZIP backup.');
                    setStatus('error');
                }
            } else {
                setError('Please upload a .json or .zip file.');
                setStatus('error');
            }
        } catch (err) {
            setError('Failed to read file.');
            setStatus('error');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-matrix-light border border-white/10 rounded-2xl p-8 space-y-6 shadow-2xl">
                <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold">Import System</h2>
                    <button onClick={onCancel} className="p-2 hover:bg-white/5 rounded-full text-matrix-muted transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {status === 'idle' && (
                    <div className="space-y-6">
                        <div className="space-y-3">
                            <div className="flex items-start gap-3 p-3 bg-matrix-dark/50 rounded-xl border border-white/5">
                                <FileJson className="text-matrix-primary shrink-0" size={20} />
                                <div className="text-xs text-matrix-muted">
                                    <span className="text-slate-200 font-bold block">PluralKit JSON</span>
                                    Standard PK export file.
                                </div>
                            </div>
                            <div className="flex items-start gap-3 p-3 bg-matrix-dark/50 rounded-xl border border-white/5">
                                <Archive className="text-matrix-primary shrink-0" size={20} />
                                <div className="text-xs text-matrix-muted">
                                    <span className="text-slate-200 font-bold block">PluralMatrix Backup (ZIP)</span>
                                    Full backup including avatars.
                                </div>
                            </div>
                        </div>

                        <div className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center hover:border-matrix-primary/50 transition-colors relative group">
                            <input 
                                type="file" 
                                accept=".json,.zip" 
                                onChange={handleFileChange}
                                className="absolute inset-0 opacity-0 cursor-pointer"
                            />
                            <div className="space-y-2 pointer-events-none">
                                <Upload className="mx-auto text-matrix-muted group-hover:text-matrix-primary transition-colors" size={40} />
                                <p className="font-medium">{file ? file.name : 'Select file'}</p>
                                <p className="text-xs text-matrix-muted">.json or .zip files</p>
                            </div>
                        </div>
                        <button 
                            disabled={!file}
                            onClick={handleImport}
                            className="matrix-button w-full"
                        >
                            Start Import
                        </button>
                    </div>
                )}

                {status === 'loading' && (
                    <div className="py-12 text-center space-y-4">
                        <div className="w-12 h-12 border-4 border-matrix-primary/20 border-t-matrix-primary rounded-full animate-spin mx-auto" />
                        <p className="text-matrix-primary font-medium animate-pulse">Processing import...</p>
                    </div>
                )}

                {status === 'success' && (
                    <div className="py-12 text-center space-y-4">
                        <CheckCircle2 className="mx-auto text-matrix-primary" size={60} />
                        <h3 className="text-xl font-bold">Import Successful!</h3>
                        <p className="text-matrix-muted">Successfully imported {count} members.</p>
                    </div>
                )}

                {status === 'error' && (
                    <div className="py-12 text-center space-y-4">
                        <AlertCircle className="mx-auto text-red-400" size={60} />
                        <h3 className="text-xl font-bold text-red-400">Import Failed</h3>
                        <p className="text-matrix-muted">{error}</p>
                        <button onClick={() => setStatus('idle')} className="matrix-button-outline w-full mt-4">
                            Try Again
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ImportTool;
