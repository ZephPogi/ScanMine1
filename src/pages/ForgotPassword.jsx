import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './ForgotPassword.css';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('teacher');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role })
      });
      // We ignore the response and just show success for security
    } catch (err) {
      console.error('Failed to request reset', err);
    } finally {
      setLoading(false);
      setSubmitted(true);
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    }
  };

  return (
    <div className="forgot-container">
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
            <>
              {/* ROLE SWITCHER TABS */}
              <div className="role-switcher">
                <button 
                  className={`role-btn ${role === 'teacher' ? 'active' : ''}`}
                  onClick={() => setRole('teacher')}
                >
                  Teacher
                </button>
                <button 
                  className={`role-btn ${role === 'student' ? 'active' : ''}`}
                  onClick={() => setRole('student')}
                >
                  Student
                </button>
              </div>

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
            </>
          ) : (
            <div className="success-message">
              <div className="success-icon">✓</div>
              <h3>Check your inbox</h3>
              <p>We've sent a password reset link to <strong>{email}</strong>.</p>
              <p className="redirect-text">Redirecting to login...</p>
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
