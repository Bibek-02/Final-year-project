import React, { useEffect, useState } from 'react';
import { Users, ShieldAlert, UserPlus, Plus, Trash2 } from 'lucide-react';
import client from '../../api/client';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import AlertBanner from '../../components/AlertBanner';
import ConfirmModal from '../../components/ConfirmModal';
import ToastStack from '../../components/Toast';
import { useToast } from '../../hooks/useToast';

export default function UserManagement({ user }) {
  const [users,         setUsers]         = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [newUsername,   setNewUsername]   = useState('');
  const [newPassword,   setNewPassword]   = useState('');
  const [newStore,      setNewStore]      = useState('');
  const [formLoading,   setFormLoading]   = useState(false);
  const [formError,     setFormError]     = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null); // username or null

  const { toasts, showToast, dismiss } = useToast();

  const fetchUsers = () => {
    setLoading(true);
    setError(null);
    client.get('/auth/users')
      .then(res => setUsers(res.data.users))
      .catch(() => setError('Failed to load users.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleCreate = async () => {
    setFormError(null);
    if (!newUsername || !newPassword || !newStore) {
      setFormError('All fields are required.'); return;
    }
    setFormLoading(true);
    try {
      await client.post('/auth/register', {
        username      : newUsername,
        password      : newPassword,
        role          : 'manager',
        assigned_store: parseInt(newStore),
      });
      showToast(`Manager '${newUsername}' created for Store ${newStore}.`, 'success');
      setNewUsername(''); setNewPassword(''); setNewStore('');
      fetchUsers();
    } catch (err) {
      setFormError(err.response?.data?.detail || 'Failed to create user.');
    } finally {
      setFormLoading(false);
    }
  };

  const confirmDelete = async () => {
    const username = pendingDelete;
    setPendingDelete(null);
    try {
      await client.delete(`/auth/users/${username}`);
      showToast(`User '${username}' deleted.`, 'success');
      fetchUsers();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Failed to delete user.', 'error');
    }
  };

  if (user?.role !== 'admin') return (
    <div className="bg-red-50 border border-red-200 text-red-700
                    dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400
                    rounded-2xl p-6 text-center text-sm flex flex-col
                    items-center gap-2">
      <ShieldAlert size={20} />
      Access denied. Admin role required.
    </div>
  );

  return (
    <div className="animate-fadeIn">
      <PageHeader
        icon={Users}
        title="User Management"
        subtitle="Create and manage store manager accounts"
      />

      {error && (
        <div className="mb-4">
          <AlertBanner variant="error" onRetry={fetchUsers}>{error}</AlertBanner>
        </div>
      )}

      {/* Create form */}
      <div className="card mb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center
                          justify-center text-green-600 dark:bg-green-500/10 dark:text-green-400">
            <UserPlus size={20} />
          </div>
          <h2 className="section-title mb-0">Create new manager</h2>
        </div>

        {formError && (
          <div className="mb-4">
            <AlertBanner variant="error">{formError}</AlertBanner>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="field-label block mb-1.5">Username</label>
            <input
              type="text"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              placeholder="e.g. store5_manager"
              className="input-field"
            />
          </div>
          <div>
            <label className="field-label block mb-1.5">Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Set a strong password"
              className="input-field"
            />
          </div>
          <div>
            <label className="field-label block mb-1.5">Assigned Store ID</label>
            <input
              type="number"
              value={newStore}
              onChange={e => setNewStore(e.target.value)}
              placeholder="e.g. 5"
              min="1"
              className="input-field"
            />
          </div>
        </div>

        <button
          onClick={handleCreate}
          disabled={formLoading}
          className={`btn-primary flex items-center gap-2 ${
            formLoading ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          {formLoading ? 'Creating...' : <><Plus size={16} /> Create Manager</>}
        </button>
      </div>

      {/* Users table */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center
                            justify-center text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
              <Users size={20} />
            </div>
            <h2 className="section-title mb-0">All users</h2>
          </div>
          <span className="badge bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            {users.length} accounts
          </span>
        </div>

        {loading ? (
          <LoadingState inline />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="table-header">
                  <th className="px-4 py-3 text-left rounded-l-xl">Username</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left">Assigned Store</th>
                  <th className="px-4 py-3 text-left rounded-r-xl">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={i} className="table-row">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-lg flex items-center
                                         justify-center text-xs font-bold text-white ${
                          u.role === 'admin' ? 'bg-indigo-600' : 'bg-green-500'
                        }`}>
                          {u.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-700 dark:text-gray-200">{u.username}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${
                        u.role === 'admin'
                          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400'
                          : 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-sm">
                      {u.assigned_store ? (
                        <span className="badge bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400">
                          Store {u.assigned_store}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500 text-xs">All stores</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.username !== 'admin' && (
                        <button
                          onClick={() => setPendingDelete(u.username)}
                          className="text-xs text-red-500 hover:text-red-700
                                     dark:text-red-400 dark:hover:text-red-300
                                     font-semibold hover:underline transition-colors
                                     flex items-center gap-1"
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!pendingDelete}
        title="Delete user"
        message={pendingDelete ? `Delete user '${pendingDelete}'? This cannot be undone.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
