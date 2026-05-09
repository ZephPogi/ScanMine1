import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './ForgotPassword.css';

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

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://scan-mine1-b7qe.vercel.app/reset-password',
      });

      if (error) {
        throw error;
      }

      // Show success state
      setSubmitted(true);
      showToast('Password reset email sent! Check your inbox.', 'success');
      setTimeout(() => {
        navigate('/login');
      }, 5000);
    } catch (err) {
      console.error('Failed to request reset:', err);
      showToast(err.message || 'Failed to send reset email. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="forgot-container">
      {/* Toast Notification */}
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* LEFT SIDE: Branding */}
      <div className="forgot-left">
        <div className="branding-wrapper">
          <h1 className="brand-name">ScanMine</h1>
          <p className="brand-description">
            Automated Answer Sheet Checking and Quiz Generator System.
            Regain access to your account quickly and securely.
          </p>
          <div className="scan-graphic">
            <div className="scanner-line"></div>
          </div>
        </div>
      </div>

      {/* RIGHT SIDE: Form */}
      <div className="forgot-right">
        <div className="form-wrapper">
          <div className="form-header">
            <h2>Reset Password</h2>
            <p>Enter your email to receive a password reset link.</p>
          </div>

          {!submitted ? (
            <form onSubmit={handleSubmit}>
              <div className="input-group">
                <label>Registered Email Address</label>
                <input 
                  type="email" 
                  placeholder="Enter your email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required 
                />
              </div>

              <button type="submit" className="signin-btn reset-btn" disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
          ) : (
            <div className="success-message">
              <div className="success-icon">✓</div>
              <h3>Check your inbox</h3>
              <p>We've sent a password reset link to <strong>{email}</strong>.</p>
              <p className="redirect-text">Redirecting to login in a few seconds...</p>
            </div>
          )}

          <p className="register-text">
            Remembered your password? <Link to="/login" className="register-link">Back to Login</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
