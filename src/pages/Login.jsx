import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import './Login.css';

const Login = () => {
  const [activeRole, setActiveRole] = useState('teacher'); // 'teacher' or 'student'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const response = await fetch('http://localhost:5000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role: activeRole }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to login');
      }

      // Login successful, save token or user data if needed here
      if (data.role === 'teacher') {
        navigate('/dashboard');
      } else {
        navigate('/student-dashboard');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="login-container">
      {/* LEFT SIDE: Branding */}
      <div className="login-left">
        <div className="branding-wrapper">
          <h1 className="brand-name">ScanMine</h1>
          <p className="brand-description">
            Automated Answer Sheet Checking and Quiz Generator System.
            Empowering educators and students through automation.
          </p>
          <div className="scan-graphic">
            <div className="scanner-line"></div>
          </div>
        </div>
      </div>

      {/* RIGHT SIDE: Login Form */}
      <div className="login-right">
        <div className="form-wrapper">
          <div className="form-header">
            <h2>Welcome Back</h2>
            <p>Please select your role and log in.</p>
          </div>

          {/* ROLE SWITCHER TABS */}
          <div className="role-switcher">
            <button 
              className={`role-btn ${activeRole === 'teacher' ? 'active' : ''}`}
              onClick={() => setActiveRole('teacher')}
            >
              Teacher
            </button>
            <button 
              className={`role-btn ${activeRole === 'student' ? 'active' : ''}`}
              onClick={() => setActiveRole('student')}
            >
              Student
            </button>
          </div>

          <form onSubmit={handleLogin}>
            {error && <div style={{ color: 'red', marginBottom: '10px', textAlign: 'center' }}>{error}</div>}
            <div className="input-group">
              <label>{activeRole === 'teacher' ? 'Faculty Email' : 'Student Email'}</label>
              <input 
                type="email" 
                placeholder="Enter your email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required 
              />
            </div>

            <div className="input-group">
              <label>Password</label>
              <input 
                type="password" 
                placeholder="••••••••" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required 
              />
            </div>

            <div className="form-footer">
              <label className="remember-me">
                <input type="checkbox" /> Remember me
              </label>
              <Link to="/forgot-password" className="forgot-password">Forgot Password?</Link>
            </div>

            <button type="submit" className="signin-btn">
              Sign In as {activeRole.charAt(0).toUpperCase() + activeRole.slice(1)}
            </button>
          </form>

          <p className="register-text">
            Don't have an account? <Link to="/signup" className="register-link">Register Now</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;