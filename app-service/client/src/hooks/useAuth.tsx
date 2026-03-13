import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services/api';

interface User {
    mxid: string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    login: (mxid: string, password: string) => Promise<void>;
    logout: () => void;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
    const [loading, setLoading] = useState(true);

    const logout = useCallback(() => {
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
    }, []);

    useEffect(() => {
        const verifyToken = async () => {
            if (token) {
                try {
                    const res = await authService.me();
                    setUser(res.data.user);
                } catch {
                    logout();
                }
            }
            setLoading(false);
        };
        verifyToken();
    }, [token, logout]);

    const login = async (mxid: string, password: string) => {
        const res = await authService.login(mxid, password);
        const { token: newToken, mxid: userMxid } = res.data;
        localStorage.setItem('token', newToken);
        setToken(newToken);
        setUser({ mxid: userMxid });
    };

    return (
        <AuthContext.Provider value={{ user, token, login, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
};

// Exporting context hooks from the same file as their provider is standard React practice.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
