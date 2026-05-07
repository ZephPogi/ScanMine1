import { useState } from 'react';
import { Lock, Camera, Edit, Users, BookOpen } from 'lucide-react';
import './StudentProfile.css';

const StudentProfile = () => {
  const [profile] = useState({
    firstName: "John",
    lastName: "Doe",
    email: "john.doe@scanmine.com",
    studentId: "2025-0012",
    gradeLevel: "Grade 10",
    section: "Rizal",
    bio: "Enthusiastic student looking forward to graduating with honors."
  });

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwords, setPasswords] = useState({
    current: '',
    newPass: '',
    confirm: '',
  });

  const handleChangePassword = () => {
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
    <>
      <main className="profile-content">
        <header className="profile-header">
          <h2>My Profile</h2>
          <p>Manage your account settings and personal information.</p>
        </header>

        <div className="profile-grid">
          {/* Left Column: Avatar & Quick Info */}
          <section className="profile-card profile-sidebar">
            <div className="avatar-section">
              <div className="profile-avatar">JD</div>
              <button className="change-photo-btn">
                <Camera size={16} />
                <span>Change Photo</span>
              </button>
            </div>
            <div className="quick-stats">
              <div className="stat-item">
                <div className="stat-icon-wrapper">
                  <BookOpen size={20} />
                </div>
                <div className="stat-info">
                  <span className="stat-value">6</span>
                  <span className="stat-label">Enrolled Classes</span>
                </div>
              </div>
              <div className="stat-item">
                <div className="stat-icon-wrapper">
                  <Users size={20} />
                </div>
                <div className="stat-info">
                  <span className="stat-value">A</span>
                  <span className="stat-label">Average Grade</span>
                </div>
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
                <label>Student ID</label>
                <input type="text" value={profile.studentId} readOnly className="locked-input" />
              </div>
              <div className="form-item">
                <label>Grade Level</label>
                <input type="text" value={profile.gradeLevel} readOnly />
              </div>
            </div>

            <div className="form-item">
              <label>Bio</label>
              <textarea value={profile.bio} rows="4" readOnly></textarea>
            </div>

            <div className="profile-actions">
              <button className="btn-edit">
                <Edit size={16} />
                <span>Edit Profile</span>
              </button>
              <button className="btn-password" onClick={() => setShowPasswordModal(true)}>
                <Lock size={16} />
                <span>Change Password</span>
              </button>
            </div>
          </section>
        </div>
      </main>

      {/* ===== CHANGE PASSWORD MODAL ===== */}
      {showPasswordModal && (
        <div className="pw-modal-overlay" onClick={closePasswordModal}>
          <div className="pw-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="pw-modal-header">
              <span className="pw-prof-label">student</span>
              <button className="pw-close-btn" onClick={closePasswordModal}>×</button>
            </div>

            <div className="pw-title-banner">
              <Lock size={20} />
              <span>Change Password</span>
            </div>

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

            <div className="pw-modal-footer">
              <button className="pw-cancel-btn" onClick={closePasswordModal}>Cancel</button>
              <button className="pw-submit-btn" onClick={handleChangePassword}>Update Password</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StudentProfile;
