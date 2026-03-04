import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { systemService } from '../services/api';
import { motion } from 'framer-motion';
import { AlertTriangle, LogOut, Check, ArrowRight, Loader2 } from 'lucide-react';

const SetupPage: React.FC = () => {
    const { token, logout } = useAuth();
    const navigate = useNavigate();
    
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const checkExistingSystem = async () => {
            if (!token) {
                navigate('/login');
                return;
            }
            try {
                const res = await systemService.get();
                if (res.data && res.data.slug) {
                    // Already have a system, go to dashboard
                    navigate(`/s/${res.data.slug}`, { replace: true });
                }
            } catch (e: any) {
                // 404 is expected here if they truly don't have a system
                if (e.response?.status !== 404) {
                    console.error('Error checking existing system:', e);
                }
            } finally {
                setLoading(false);
            }
        };
        checkExistingSystem();
    }, [token, navigate]);

    const handleCreateSystem = async () => {
        setLoading(true);
        setError(null);
        try {
            await systemService.create();
            // System created successfully, move to warning step
            setStep(2);
        } catch (e: any) {
            console.error('Failed to create system:', e);
            setError(e.response?.data?.error || 'Failed to create system.');
        } finally {
            setLoading(false);
        }
    };

    const handleAcknowledge = () => {
        navigate('/'); // Will hit SystemRedirector and go to the new system slug
    };

    const handleLogout = () => {
        logout();
        navigate('/login', { replace: true });
    };

    if (loading && step === 1) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-matrix-dark">
                <Loader2 className="w-12 h-12 text-matrix-primary animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-matrix-dark text-matrix-text px-4">
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-matrix-light p-8 rounded-3xl border border-white/5 max-w-lg shadow-2xl space-y-6"
            >
                {step === 1 ? (
                    <>
                        <h2 className="text-2xl font-bold text-center">Welcome to PluralMatrix</h2>
                        <p className="text-matrix-muted text-center">
                            You are logged in, but you do not have a system registered with PluralMatrix yet.
                        </p>
                        
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-sm text-center">
                                {error}
                            </div>
                        )}

                        <div className="flex flex-col gap-3 pt-4">
                            <button 
                                onClick={handleCreateSystem}
                                disabled={loading}
                                className="matrix-button w-full flex items-center justify-center font-bold"
                            >
                                {loading ? 'Creating...' : (
                                    <>
                                        Create a System <ArrowRight size={18} className="ml-2" />
                                    </>
                                )}
                            </button>
                            <button 
                                onClick={handleLogout}
                                disabled={loading}
                                className="matrix-button-ghost w-full flex items-center justify-center text-matrix-muted hover:text-white"
                            >
                                <LogOut size={18} className="mr-2" /> Log out
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto text-green-500 mb-4">
                            <Check size={32} />
                        </div>
                        <h2 className="text-2xl font-bold text-center">System Created!</h2>
                        
                        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-5 space-y-4">
                            <h3 className="font-bold flex items-center text-yellow-500">
                                <AlertTriangle size={18} className="mr-2" />
                                Please Note
                            </h3>
                            
                            <div className="space-y-3 text-sm text-matrix-muted">
                                <p>
                                    <strong className="text-white">Public Profiles:</strong> All system and member metadata is publicly accessible. Do not store private info in your profiles.
                                </p>
                                <p>
                                    <strong className="text-white">Message Content:</strong> Your messages are not public, but using plural_bot in encrypted rooms allows the <strong>homeserver administrator</strong> to read them.
                                </p>
                                <p>
                                    <strong className="text-white">Data Control:</strong> We don't use tokens. Use the web UI to export your data regularly for backups or to move servers.
                                </p>
                            </div>
                        </div>

                        <button 
                            onClick={handleAcknowledge}
                            className="matrix-button w-full flex items-center justify-center font-bold"
                        >
                            I understand, proceed to Dashboard
                        </button>
                    </>
                )}
            </motion.div>
        </div>
    );
};

export default SetupPage;
