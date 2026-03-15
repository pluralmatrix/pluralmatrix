import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { getAvatarUrl } from '../utils/matrix';
import { Clock, Plus, Loader2, X, User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import type { SystemMember, PluralSystem } from '../types';

export interface FrontingViewProps {
  isOwner: boolean;
  members: SystemMember[];
  system: PluralSystem;
}

interface Switch {
  id: string;
  timestamp: string;
  members: { member: SystemMember }[];
}

const FrontingView: React.FC<FrontingViewProps> = ({ isOwner, members, system }) => {
  const [switches, setSwitches] = useState<Switch[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditingFront, setIsEditingFront] = useState(false);
  const [selectedFronters, setSelectedFronters] = useState<string[]>([]);

  const fetchSwitches = async () => {
    try {
      const res = await api.get('/system/switches');
      setSwitches(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOwner) {
      fetchSwitches();
    } else {
      // For public viewing, we can fetch public switches if there's an endpoint
      // Assuming public switches are included in the system API or a separate public endpoint.
      // For now, let's say public switches are fetched from `/system/public/${system.slug}/switches` if we had one.
      // Let's assume we don't show history to public unless we implemented it, or we just show the first.
      setLoading(false);
    }
  }, [isOwner, system]);

  const handleLogSwitch = async () => {
    try {
      setLoading(true);
      await api.post('/system/switches', { members: selectedFronters });
      setIsEditingFront(false);
      await fetchSwitches();
    } catch (e) {
      console.error(e);
      alert('Failed to log switch');
      setLoading(false);
    }
  };

  if (!isOwner) {
    return (
      <div className="text-center py-20">
        <p className="text-matrix-muted">Fronting view is currently only available for system owners.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-8 h-8 text-matrix-primary animate-spin" />
      </div>
    );
  }

  const currentSwitch = switches[0];

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Current Front */}
      <div className="bg-matrix-light border border-white/10 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-matrix-primary/5 blur-[100px] pointer-events-none" />

        <div className="flex justify-between items-start mb-6 relative z-10">
          <div>
            <h3 className="text-2xl font-bold mb-1">Current Fronters</h3>
            <p className="text-matrix-muted text-sm">
              {currentSwitch ? `Since ${new Date(currentSwitch.timestamp).toLocaleString()}` : 'No current fronters.'}
            </p>
          </div>
          {!isEditingFront && (
            <button
              onClick={() => {
                setSelectedFronters(currentSwitch ? currentSwitch.members.map((m) => m.member.id) : []);
                setIsEditingFront(true);
              }}
              data-testid="log-switch-button"
              className="matrix-button py-2 text-sm flex items-center shadow-lg shadow-matrix-primary/20"
            >
              <Plus size={16} className="mr-2" /> Log Switch
            </button>
          )}
        </div>

        <AnimatePresence mode="wait">
          {isEditingFront ? (
            <motion.div
              key="editing"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <div className="flex flex-wrap gap-2 mb-4">
                {selectedFronters.map((memberId) => {
                  const member = members.find((m) => m.id === memberId);
                  return (
                    <div
                      key={memberId}
                      className="flex items-center bg-matrix-dark/80 rounded-full pl-3 pr-1 py-1 border border-white/5"
                    >
                      <span className="text-sm font-bold mr-2">{member?.name || 'Unknown'}</span>
                      <button
                        onClick={() => setSelectedFronters((prev) => prev.filter((id) => id !== memberId))}
                        data-testid={`remove-fronter-${memberId}`}
                        className="p-1 hover:bg-red-500/20 text-matrix-muted hover:text-red-400 rounded-full transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="bg-matrix-dark/50 p-4 rounded-xl border border-white/5 max-h-64 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {[...members]
                  .filter((m) => !selectedFronters.includes(m.id))
                  .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                  .map((member) => (
                    <button
                      key={member.id}
                      onClick={() => setSelectedFronters((prev) => [...prev, member.id])}
                      className="flex items-center p-2 rounded-lg hover:bg-white/5 transition-colors text-left"
                    >
                      {member.avatarUrl ? (
                        <img
                          src={getAvatarUrl(member.avatarUrl) || undefined}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover mr-3"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-matrix-dark flex items-center justify-center mr-3 font-bold text-xs uppercase border border-white/10">
                          {member.name.substring(0, 2)}
                        </div>
                      )}
                      <span className="font-medium text-sm truncate">{member.name}</span>
                    </button>
                  ))}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                <button
                  onClick={() => setIsEditingFront(false)}
                  className="px-4 py-2 rounded-lg font-bold text-sm text-matrix-muted hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLogSwitch}
                  data-testid="save-switch-button"
                  className="matrix-button py-2 px-6 text-sm"
                >
                  Save Switch
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="viewing"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              className="flex flex-wrap gap-4"
            >
              {currentSwitch?.members.length ? (
                currentSwitch.members.map((sm, idx) => (
                  <div
                    key={idx}
                    className="flex items-center space-x-3 bg-matrix-dark/50 p-3 rounded-2xl border border-white/5 pr-6"
                  >
                    {sm.member.avatarUrl ? (
                      <img
                        src={getAvatarUrl(sm.member.avatarUrl) || undefined}
                        alt=""
                        className="w-12 h-12 rounded-xl object-cover shadow-md"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-matrix-dark flex items-center justify-center font-bold text-lg uppercase border border-white/10 shadow-md">
                        {sm.member.name.substring(0, 2)}
                      </div>
                    )}
                    <div>
                      <div className="font-bold">{sm.member.name}</div>
                      <div className="text-xs text-matrix-muted">Fronter {idx + 1}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-matrix-muted flex items-center">
                  <User size={18} className="mr-2 opacity-50" /> No one is currently fronting.
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* History */}
      <div>
        <h3 className="text-xl font-bold mb-4 flex items-center">
          <Clock size={20} className="mr-2 text-matrix-primary" /> Recent History
        </h3>
        <div className="space-y-3">
          {switches.slice(1).map((sw, idx) => (
            <div
              key={idx}
              className="bg-matrix-light border border-white/5 rounded-xl p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div className="flex -space-x-3">
                  {sw.members.length > 0 ? (
                    sw.members.map((sm, i) => (
                      <div
                        key={i}
                        className="w-10 h-10 rounded-full border-2 border-matrix-light overflow-hidden bg-matrix-dark flex items-center justify-center z-10 relative"
                      >
                        {sm.member.avatarUrl ? (
                          <img
                            src={getAvatarUrl(sm.member.avatarUrl) || undefined}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-xs font-bold uppercase">{sm.member.name.substring(0, 2)}</span>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="w-10 h-10 rounded-full border-2 border-matrix-light overflow-hidden bg-matrix-dark flex items-center justify-center z-10 relative text-matrix-muted">
                      <X size={16} />
                    </div>
                  )}
                </div>
                <div>
                  <div className="font-bold">
                    {sw.members.length > 0
                      ? sw.members.map((m) => m.member.name).join(', ')
                      : 'Switch-out (No fronters)'}
                  </div>
                </div>
              </div>
              <div className="text-sm text-matrix-muted">{new Date(sw.timestamp).toLocaleString()}</div>
            </div>
          ))}
          {switches.length <= 1 && (
            <div className="text-center py-8 text-matrix-muted border border-dashed border-white/10 rounded-xl">
              No historical switches recorded yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FrontingView;
