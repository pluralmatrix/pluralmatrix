import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { systemService } from './services/api';
import { useAuth } from './hooks/useAuth';
import { Loader2 } from 'lucide-react';

const SystemRedirector: React.FC = () => {
    const { token } = useAuth();
    const [slug, setSlug] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [needsSetup, setNeedsSetup] = useState(false);
    const [error, setError] = useState(false);

    useEffect(() => {
        const fetchMySystem = async () => {
            if (!token) {
                setLoading(false);
                return;
            }
            try {
                const res = await systemService.get();
                setSlug(res.data.slug);
            } catch (e: any) {
                if (e.response && e.response.status === 404) {
                    setNeedsSetup(true);
                } else {
                    console.error('Failed to redirect to system:', e);
                    setError(true);
                }
            } finally {
                setLoading(false);
            }
        };
        fetchMySystem();
    }, [token]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-matrix-dark">
                <Loader2 className="w-12 h-12 text-matrix-primary animate-spin" />
            </div>
        );
    }

    if (needsSetup) {
        return <Navigate to="/setup" replace />;
    }

    if (error || !slug) {
        return <Navigate to="/login" />;
    }

    return <Navigate to={`/s/${slug}`} replace />;
};

export default SystemRedirector;
