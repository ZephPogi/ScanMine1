import { useState, useEffect, useCallback } from 'react';
import Sidebar from './Sidebar';
import { Lock, Edit, Check, X, BookOpen, Users, Loader2, UserCircle } from 'lucide-react';
import './TeacherProfile.css';

// ── Toast notification helper ──────────────────────────────────────────────
const Toast = ({ toast }) => {
  if (!toast) return null;
  return (
    <div className={`profile-toast profile-toast--${toast.type}`}>
      <div className="toast-icon">
        {toast.type === 'success' ? <Check size={14} /> : <X size={14} />}
      </div>
      <span>{toast.message}</span>
    </div>
  );
};

const TeacherProfile = () => {
  const storedUser = JSON.parse(localStorage.getItem('user') || '{}');

  // ── Profile data state ────────────────────────────────────────────────────
  const [profile, setProfile] = useState({
    firstName: '',
    middleInitial: '',
    lastName: '',
    email: '',
    role: '',
  });
  const [stats, setStats] = useState({ activeClasses: 0, totalStudents: 0 });
  const [loading, setLoading] = useState(true);

  // ── Edit mode state ───────────────────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ firstName: '', middleInitial: '', lastName: '' });
  const [saving, setSaving] = useState(false);

  // ── Password modal state ──────────────────────────────────────────────────
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);

  // ── Toast state ───────────────────────────────────────────────────────────
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Fetch profile + stats ─────────────────────────────────────────────────
  const fetchProfile = useCallback(async () => {
    if (!storedUser.id) return;
    setLoading(true);
    try {
      const [profileRes, dashRes] = await Promise.all([
        fetch(`/api/user/profile?userId=${storedUser.id}`),
        fetch(`/api/dashboard?teacherId=${storedUser.id}`),
      ]);

      if (profileRes.ok) {
        const data = await profileRes.json();
        // Prefer explicit columns; fall back to splitting the composite name
        const fn = data.first_name || (data.name || '').trim().split(' ')[0] || '';
        const mi = data.middle_initial || '';
        const ln = data.last_name || (data.name || '').trim().split(' ').slice(1).join(' ') || '';
        setProfile({ firstName: fn, middleInitial: mi, lastName: ln, email: data.email, role: data.role });
        setEditForm({ firstName: fn, middleInitial: mi, lastName: ln });
      }

      if (dashRes.ok) {
        const dash = await dashRes.json();
        // Get distinct class count from dashboard data
        const classesRes = await fetch(`/api/classes?teacherId=${storedUser.id}`);
        const classes = classesRes.ok ? await classesRes.json() : [];
        setStats({
          activeClasses: classes.length,
          totalStudents: dash.totalStudents || 0,
        });
      }
    } catch (err) {
      console.error('Profile fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [storedUser.id]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  // ── Computed avatar initials ──────────────────────────────────────────────
  const initials = `${profile.firstName?.[0] || ''}${profile.lastName?.[0] || ''}`.toUpperCase() || 'T';

  // ── Computed display name ─────────────────────────────────────────────────
  const displayName = [profile.firstName, profile.middleInitial ? `${profile.middleInitial.toUpperCase()}.` : '', profile.lastName].filter(Boolean).join(' ');

  // ── Save name ─────────────────────────────────────────────────────────────
  const handleSaveName = async () => {
    if (!editForm.firstName.trim() || !editForm.lastName.trim()) {
      showToast('First and last name cannot be empty.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/user/update-name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId:        storedUser.id,
          firstName:     editForm.firstName.trim(),
          middleInitial: editForm.middleInitial.trim().toUpperCase().slice(0, 1),
          lastName:      editForm.lastName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update name');

      // Update localStorage so the sidebar greets with the new name
      const updated = { ...storedUser, name: data.user.name };
      localStorage.setItem('user', JSON.stringify(updated));

      setProfile(prev => ({ ...prev, firstName: editForm.firstName.trim(), middleInitial: editForm.middleInitial.trim().toUpperCase().slice(0,1), lastName: editForm.lastName.trim() }));
      setIsEditing(false);
      showToast('Name updated successfully!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditForm({ firstName: profile.firstName, middleInitial: profile.middleInitial, lastName: profile.lastName });
    setIsEditing(false);
  };

  // ── Change password ───────────────────────────────────────────────────────
  const handleChangePassword = async () => {
    if (!passwords.current || !passwords.newPass || !passwords.confirm) {
      showToast('Please fill in all password fields.', 'error');
      return;
    }
    if (passwords.newPass !== passwords.confirm) {
      showToast('New passwords do not match.', 'error');
      return;
    }
    if (passwords.newPass.length < 6) {
      showToast('Password must be at least 6 characters.', 'error');
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch('/api/user/update-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: storedUser.id,
          currentPassword: passwords.current,
          newPassword: passwords.newPass,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update password');

      setShowPasswordModal(false);
      setPasswords({ current: '', newPass: '', confirm: '' });
      showToast('Password updated successfully!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setPwSaving(false);
    }
  };

  const closePasswordModal = () => {
    setShowPasswordModal(false);
    setPasswords({ current: '', newPass: '', confirm: '' });
  };

  return (
    <div className="page-layout">
      <Sidebar />
      <main className="profile-content">
        <Toast toast={toast} />

        <header className="profile-header">
          <h2>My Profile</h2>
          <p>Manage your account settings and personal information.</p>
        </header>

        {loading ? (
          <div className="profile-loading">
            <Loader2 size={32} className="profile-loading-spin" />
            <span>Loading profile…</span>
          </div>
        ) : (
          <div className="profile-grid">
            {/* ── Left Column: Avatar & Stats ── */}
            <section className="profile-card profile-sidebar">
              <div className="profile-card-accent" />
              <div className="profile-card-body">
                <div className="avatar-section">
                  <div className="profile-avatar-wrapper">
                    <div className="profile-avatar">{initials}</div>
                  </div>
                  <div className="profile-name-display">
                    <strong>{displayName}</strong>
                    <span className="profile-role-badge">{profile.role}</span>
                  </div>
                </div>

                <div className="quick-stats">
                  <div className="stat-item">
                    <div className="stat-icon-wrapper teal"><BookOpen size={20} /></div>
                    <div className="stat-info">
                      <span className="stat-value">{stats.activeClasses}</span>
                      <span className="stat-label">Active Classes</span>
                    </div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-icon-wrapper indigo"><Users size={20} /></div>
                    <div className="stat-info">
                      <span className="stat-value">{stats.totalStudents}</span>
                      <span className="stat-label">Total Students</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ── Right Column: Details Form ── */}
            <section className="profile-card profile-details">
              <div className="profile-card-accent" />
              <div className="profile-card-body">
                <div className="section-title-row">
                  <div className="section-title-icon"><UserCircle size={18} /></div>
                  <h3>Personal Information</h3>
                </div>

                {/* Editable: First / Middle Initial / Last Name */}
                <div className="form-group-row">
                  <div className="form-item">
                    <label>First Name</label>
                    <input
                      type="text"
                      value={isEditing ? editForm.firstName : profile.firstName}
                      readOnly={!isEditing}
                      disabled={!isEditing}
                      className={isEditing ? 'input-active' : 'input-readonly'}
                      onChange={e => setEditForm(prev => ({ ...prev, firstName: e.target.value }))}
                      placeholder="First Name"
                    />
                  </div>
                  <div className="form-item" style={{ maxWidth: '90px' }}>
                    <label>M.I.</label>
                    <input
                      type="text"
                      value={isEditing ? editForm.middleInitial : profile.middleInitial}
                      readOnly={!isEditing}
                      disabled={!isEditing}
                      className={isEditing ? 'input-active' : 'input-readonly'}
                      onChange={e => setEditForm(prev => ({ ...prev, middleInitial: e.target.value.toUpperCase().slice(0,1) }))}
                      placeholder="Z"
                      maxLength={1}
                      style={{ textAlign: 'center', textTransform: 'uppercase' }}
                    />
                  </div>
                  <div className="form-item">
                    <label>Last Name</label>
                    <input
                      type="text"
                      value={isEditing ? editForm.lastName : profile.lastName}
                      readOnly={!isEditing}
                      disabled={!isEditing}
                      className={isEditing ? 'input-active' : 'input-readonly'}
                      onChange={e => setEditForm(prev => ({ ...prev, lastName: e.target.value }))}
                      placeholder="Last Name"
                    />
                  </div>
                </div>

                {/* Read-only: Email */}
                <div className="form-item">
                  <label>
                    Email Address
                    <span className="locked-badge">Read-only</span>
                  </label>
                  <input
                    type="email"
                    value={profile.email}
                    readOnly
                    disabled
                    className="input-locked"
                  />
                </div>

                {/* Read-only: Role */}
                <div className="form-item">
                  <label>
                    Role / Position
                    <span className="locked-badge">Read-only</span>
                  </label>
                  <input
                    type="text"
                    value={profile.role ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1) : ''}
                    readOnly
                    disabled
                    className="input-locked"
                  />
                </div>

                {/* Actions */}
                <div className="profile-actions">
                  {isEditing ? (
                    <>
                      <button className="btn-save" onClick={handleSaveName} disabled={saving}>
                        {saving ? (
                          <><Loader2 size={16} className="btn-spinner" /><span>Saving…</span></>
                        ) : (
                          <><Check size={16} /><span>Save Changes</span></>
                        )}
                      </button>
                      <button className="btn-cancel" onClick={handleCancelEdit} disabled={saving}>
                        <X size={16} />
                        <span>Cancel</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn-edit" onClick={() => setIsEditing(true)}>
                        <Edit size={16} />
                        <span>Edit Profile</span>
                      </button>
                      <button className="btn-password" onClick={() => setShowPasswordModal(true)}>
                        <Lock size={16} />
                        <span>Change Password</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* ── Change Password Modal ── */}
      {showPasswordModal && (
        <div className="pw-modal-overlay" onClick={closePasswordModal}>
          <div className="pw-modal-content" onClick={e => e.stopPropagation()}>
            <div className="pw-modal-header">
              <span className="pw-prof-label">Security</span>
              <button className="pw-close-btn" onClick={closePasswordModal}>×</button>
            </div>

            <div className="pw-title-banner">
              <Lock size={20} />
              <span>Update Your Password</span>
            </div>

            <div className="pw-form">
              <div className="pw-field">
                <label className="pw-label">Current Password</label>
                <input
                  type="password"
                  className="pw-input"
                  placeholder="Enter current password"
                  value={passwords.current}
                  onChange={e => setPasswords(p => ({ ...p, current: e.target.value }))}
                />
              </div>
              <div className="pw-field">
                <label className="pw-label">New Password</label>
                <input
                  type="password"
                  className="pw-input"
                  placeholder="Min. 6 characters"
                  value={passwords.newPass}
                  onChange={e => setPasswords(p => ({ ...p, newPass: e.target.value }))}
                />
              </div>
              <div className="pw-field">
                <label className="pw-label">Confirm New Password</label>
                <input
                  type="password"
                  className="pw-input"
                  placeholder="Re-enter new password"
                  value={passwords.confirm}
                  onChange={e => setPasswords(p => ({ ...p, confirm: e.target.value }))}
                />
              </div>
            </div>

            <div className="pw-modal-footer">
              <button className="pw-cancel-btn" onClick={closePasswordModal} disabled={pwSaving}>
                Cancel
              </button>
              <button className="pw-submit-btn" onClick={handleChangePassword} disabled={pwSaving}>
                {pwSaving ? (
                  <><Loader2 size={16} className="btn-spinner" /> Updating…</>
                ) : (
                  <><Lock size={15} /> Update Password</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherProfile;