import { useState } from 'react';
import Sidebar from './Sidebar';
import './TeacherProfile.css';

const TeacherProfile = () => {
  const [profile, setProfile] = useState({
    firstName: "Maria",
    lastName: "Santos",
    email: "m.santos@university.edu.ph",
    employeeId: "2024-5501",
    department: "Social Sciences",
    position: "Senior High School Teacher",
    bio: "Dedicated educator with 5 years of experience in History and Political Science. Passionate about integrating technology in classroom assessment."
  });

  // Change Password modal state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwords, setPasswords] = useState({
    current: '',
    newPass: '',
    confirm: '',
  });

  const handleChangePassword = () => {
    // TODO: Implement password change logic
    if (passwords.newPass !== passwords.confirm) {
      alert('New passwords do not match!');
      return;
    }
    console.log('Password change requested');
    setShowPasswordModal(false);
    setPasswords({ current: '', newPass: '', confirm: '' });
  };

  const closePasswordModal = () => {
    setShowPasswordModal(false);
    setPasswords({ current: '', newPass: '', confirm: '' });
  };

  return (
    <div className="page-layout">
      <Sidebar />
      <main className="profile-content">
        <header className="profile-header">
          <h2>My Profile</h2>
          <p>Manage your account settings and personal information.</p>
        </header>

        <div className="profile-grid">
          {/* Left Column: Avatar & Quick Info */}
          <section className="profile-card profile-sidebar">
            <div className="avatar-section">
              <div className="profile-avatar">MS</div>
              <button className="change-photo-btn">Change Photo</button>
            </div>
            <div className="quick-stats">
              <div className="stat-item">
                <span className="stat-value">4</span>
                <span className="stat-label">Active Classes</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">165</span>
                <span className="stat-label">Total Students</span>
              </div>
            </div>
          </section>

          {/* Right Column: Detailed Form */}
          <section className="profile-card profile-details">
            <div className="form-group-row">
              <div className="form-item">
                <label>First Name</label>
                <input type="text" value={profile.firstName} readOnly />
              </div>
              <div className="form-item">
                <label>Last Name</label>
                <input type="text" value={profile.lastName} readOnly />
              </div>
            </div>

            <div className="form-item">
              <label>Email Address</label>
              <input type="email" value={profile.email} readOnly />
            </div>

            <div className="form-group-row">
              <div className="form-item">
                <label>Employee ID</label>
                <input type="text" value={profile.employeeId} readOnly className="locked-input" />
              </div>
              <div className="form-item">
                <label>Department</label>
                <input type="text" value={profile.department} readOnly />
              </div>
            </div>

            <div className="form-item">
              <label>Bio</label>
              <textarea value={profile.bio} rows="4" readOnly></textarea>
            </div>

            <div className="profile-actions">
              <button className="btn-edit">Edit Profile</button>
              <button className="btn-password" onClick={() => setShowPasswordModal(true)}>Change Password</button>
            </div>
          </section>
        </div>
      </main>

      {/* ===== CHANGE PASSWORD MODAL ===== */}
      {showPasswordModal && (
        <div className="pw-modal-overlay" onClick={closePasswordModal}>
          <div className="pw-modal-content" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="pw-modal-header">
              <span className="pw-prof-label">prof</span>
              <button className="pw-close-btn" onClick={closePasswordModal}>×</button>
            </div>

            <div className="pw-title-banner">
              🔒 Change Password
            </div>

            {/* Form */}
            <div className="pw-form">
              <div className="pw-field">
                <label className="pw-label">Current Password</label>
                <input
                  type="password"
                  className="pw-input"
                  placeholder="Enter current password"
                  value={passwords.current}
                  onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                />
              </div>

              <div className="pw-field">
                <label className="pw-label">New Password</label>
                <input
                  type="password"
                  className="pw-input"
                  placeholder="Enter new password"
                  value={passwords.newPass}
                  onChange={(e) => setPasswords({ ...passwords, newPass: e.target.value })}
                />
              </div>

              <div className="pw-field">
                <label className="pw-label">Confirm New Password</label>
                <input
                  type="password"
                  className="pw-input"
                  placeholder="Re-enter new password"
                  value={passwords.confirm}
                  onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                />
              </div>
            </div>

            {/* Submit */}
            <div className="pw-modal-footer">
              <button className="pw-cancel-btn" onClick={closePasswordModal}>Cancel</button>
              <button className="pw-submit-btn" onClick={handleChangePassword}>Update Password</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherProfile;