import { useState } from 'react';
import StudentSidebar from './StudentSidebar';
import './StudentProfile.css';

const StudentProfile = () => {
  const [email, setEmail] = useState('john.doe@scanmine.com');
  const [editingEmail, setEditingEmail] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' });

  const handleUpdatePassword = () => {
    if (passwords.newPass !== passwords.confirm) {
      alert('New passwords do not match!');
      return;
    }
    console.log('Password updated');
    setPasswords({ current: '', newPass: '', confirm: '' });
  };

  return (
    <div className="student-page-layout">
      <StudentSidebar />
      <div className="student-main">
        {/* Header */}
        <header className="sp-header">
          <div>
            <p className="sp-label">both student and teacher</p>
            <h1>Profile</h1>
          </div>
          <div className="student-avatar-circle">JD</div>
        </header>

        <div className="sp-card">
          {/* Avatar */}
          <div className="sp-avatar-section">
            <div className="sp-avatar">JD</div>
            <button className="sp-change-photo">Change Photo</button>
            <h2 className="sp-name">John Doe</h2>
            <p className="sp-role">Teacher</p>
          </div>

          {/* Email */}
          <div className="sp-field-group">
            <label className="sp-field-label">Email Address</label>
            <div className="sp-email-row">
              <input
                type="email"
                className="sp-input"
                value={email}
                readOnly={!editingEmail}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button
                className="sp-change-email-btn"
                onClick={() => setEditingEmail(!editingEmail)}
              >
                {editingEmail ? 'Save' : 'Change'}
              </button>
            </div>
          </div>

          {/* Change Password */}
          <div className="sp-field-group">
            <label className="sp-field-label">Change Password</label>
            <input
              type="password"
              className="sp-input sp-input-mb"
              placeholder="Current Password"
              value={passwords.current}
              onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
            />
            <input
              type="password"
              className="sp-input sp-input-mb"
              placeholder="New Password"
              value={passwords.newPass}
              onChange={(e) => setPasswords({ ...passwords, newPass: e.target.value })}
            />
            <div className="sp-confirm-row">
              <input
                type="password"
                className="sp-input"
                placeholder="Confirm New Password"
                value={passwords.confirm}
                onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
              />
              <button className="sp-update-btn" onClick={handleUpdatePassword}>Update</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentProfile;
