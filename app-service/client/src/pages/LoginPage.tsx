import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Shield, Lock, User } from 'lucide-react';

const LoginPage: React.FC = () => {
    const [mxid, setMxid] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await login(mxid, password);
            navigate('/');
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to login. Please check your credentials.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-md w-full matrix-card p-8 space-y-8"
            >
                <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-matrix-primary/10 text-matrix-primary mb-2">
                        <Shield size={32} />
                    </div>
                    <h1 className="text-3xl font-bold">PluralMatrix</h1>
                    <p className="text-matrix-muted text-sm">Sign in with your Matrix credentials</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-4">
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-matrix-muted" size={18} />
                            <input
                                data-testid="login-mxid-input"
                                type="text"
                                placeholder="@user:server.com"
                                value={mxid}
                                onChange={(e) => setMxid(e.target.value)}
                                className="matrix-input pl-10"
                                required
                            />
                        </div>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-matrix-muted" size={18} />
                            <input
                                data-testid="login-password-input"
                                type="password"
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="matrix-input pl-10"
                                required
                            />
                        </div>
                    </div>

                    {error && <div className="text-red-400 text-sm text-center bg-red-400/10 py-2 rounded-lg">{error}</div>}

                    <button
                        data-testid="login-submit-button"
                        type="submit"
                        disabled={loading}
                        className="matrix-button w-full"
                    >
                        {loading ? 'Authenticating...' : 'Sign In'}
                    </button>
                </form>
            </motion.div>
        </div>
    );
};

export default LoginPage;
