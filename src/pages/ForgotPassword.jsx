import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import AuthBrandPanel from '../components/AuthBrandPanel';
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
    <div className="auth-page">
      {/* Toast Notification */}
      {toast && <Toast message={toast.message} type={toast.type} />}

      <AuthBrandPanel />

      {/* RIGHT SIDE: Form */}
      <div className="auth-form-side">
        <div className="auth-form-card">
          <div className="auth-form-header">
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
            Remembered your password? <Link to="/login" className="register-link">Login here</Link>
            {' · '}
            <Link to="/signup" className="register-link">Register Now</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
