import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import './ResetPassword.css';

const ResetPassword = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('http://localhost:5000/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword })
      });
      
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="reset-container">
      <div className="reset-left">
        <div className="branding-wrapper">
          <h1 className="brand-name">ScanMine</h1>
          <p className="brand-description">
            Automated Answer Sheet Checking and Quiz Generator System.
            Securely set a new password for your account.
          </p>
        </div>
      </div>

      <div className="reset-right">
        <div className="form-wrapper">
          <div className="form-header">
            <h2>Set New Password</h2>
            <p>Please enter a secure new password.</p>
          </div>

          {success ? (
            <div className="success-message">
              <div className="success-icon">✓</div>
              <h3>Password Reset!</h3>
              <p>Your password has been changed successfully.</p>
              <p className="redirect-text">Redirecting to login...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {error && <div style={{ color: 'red', marginBottom: '10px', textAlign: 'center' }}>{error}</div>}
              
              <div className="input-group">
                <label>New Password</label>
                <input 
                  type="password" 
                  placeholder="••••••••" 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required 
                />
              </div>

              <div className="input-group">
                <label>Confirm New Password</label>
                <input 
                  type="password" 
                  placeholder="••••••••" 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required 
                />
              </div>

              <button type="submit" className="signin-btn reset-btn" disabled={loading}>
                {loading ? 'Resetting...' : 'Change Password'}
              </button>

              <p className="register-text" style={{marginTop: '20px'}}>
                <Link to="/login" className="register-link">Cancel</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
