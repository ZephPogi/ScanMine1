import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './ResetPassword.css';

// Simple toast notification component
const Toast = ({ message, type }) => (
  <div style={{
    position: 'fixed',
    top: '20px',
    right: '20px',
    padding: '14px 20px',
    borderRadius: '12px',
    background: type === 'success' ? '#10b981' : '#ef4444',
    color: 'white',
    fontWeight: 600,
    fontSize: '0.9rem',
    boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
    zIndex: 9999,
    maxWidth: '320px',
    animation: 'slideInRight 0.3s ease',
  }}>
    {type === 'success' ? '✅ ' : '❌ '}{message}
  </div>
);

const ResetPassword = () => {
  const navigate = useNavigate();
  
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [toast, setToast] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Supabase sends the user to this page with an access token in the URL hash.
  // We listen for the PASSWORD_RECOVERY event to confirm the session is ready.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSessionReady(true);
      }
    });

    // Also check if there's already an active session from the URL hash
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      showToast('Passwords do not match', 'error');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      showToast('Password must be at least 6 characters', 'error');
      return;
    }

    setLoading(true);

    try {
      // Use supabase.auth.updateUser() to set the new password.
      // Supabase automatically uses the session established from the reset link.
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        throw updateError;
      }

      setSuccess(true);
      showToast('Password updated successfully!', 'success');
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      console.error('Failed to reset password:', err);
      const message = err.message || 'Failed to reset password. The link may have expired.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="reset-container">
      {/* Toast Notification */}
      {toast && <Toast message={toast.message} type={toast.type} />}

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
              {error && (
                <div style={{
                  color: '#dc2626',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  marginBottom: '16px',
                  textAlign: 'center',
                  fontSize: '0.9rem',
                }}>
                  {error}
                </div>
              )}

              {!sessionReady && (
                <div style={{
                  color: '#92400e',
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  marginBottom: '16px',
                  textAlign: 'center',
                  fontSize: '0.85rem',
                }}>
                  ⏳ Verifying your reset link… If this message persists, request a new reset email.
                </div>
              )}
              
              <div className="input-group">
                <label>New Password</label>
                <input 
                  type="password" 
                  placeholder="••••••••" 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required 
                  minLength={6}
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
                  minLength={6}
                />
              </div>

              <button
                type="submit"
                className="signin-btn reset-btn"
                disabled={loading || !sessionReady}
              >
                {loading ? 'Updating Password...' : 'Change Password'}
              </button>

              <p className="register-text" style={{marginTop: '20px'}}>
                <Link to="/login" className="register-link">Cancel & Back to Login</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
