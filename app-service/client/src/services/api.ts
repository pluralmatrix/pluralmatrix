import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
    baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export const authService = {
    login: (mxid: string, password: string) => 
        api.post('/auth/login', { mxid, password }),
    me: () => api.get('/auth/me'),
};

export const memberService = {
    list: () => api.get('/members'),
    create: (data: any) => api.post('/members', data),
    update: (id: string, data: any) => api.patch(`/members/${id}`, data),
    delete: (id: string) => api.delete(`/members/${id}`),
    deleteAll: () => api.delete('/members'),
    
    // PluralKit Imports
    importPkJson: (data: any) => api.post('/import/pk/json', data),

    // Unified Backup Imports
    importBackupZip: (file: File) => {
        return api.post('/import/backup/zip', file, {
            headers: { 'Content-Type': 'application/zip' }
        });
    },

    // Exports
    exportPkZip: () => {
        const token = localStorage.getItem('token');
        window.open(`${API_BASE}/import/pk/zip?token=${token}`, '_blank');
    },
    exportBackupZip: () => {
        const token = localStorage.getItem('token');
        window.open(`${API_BASE}/import/backup/zip?token=${token}`, '_blank');
    },
    
    uploadMedia: (file: File) => {
        return api.post(`/media/upload?filename=${encodeURIComponent(file.name)}`, file, {
            headers: { 'Content-Type': file.type }
        });
    }
};

export const systemService = {
    get: () => api.get('/system'),
    update: (data: any) => api.patch('/system', data),
    getLinks: () => api.get('/system/links'),
    createLink: (targetMxid: string) => api.post('/system/links', { targetMxid }),
    setPrimaryLink: (targetMxid: string) => api.post('/system/links/primary', { targetMxid }),
    deleteLink: (mxid: string) => api.delete(`/system/links/${encodeURIComponent(mxid)}`),
    getDeadLetters: () => api.get('/system/dead_letters'),
    deleteDeadLetter: (id: string) => api.delete(`/system/dead_letters/${encodeURIComponent(id)}`),
    getPublic: (slug: string) => api.get(`/system/public/${slug}`)
};

export default api;
