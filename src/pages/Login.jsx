import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './Login.css';

const Login = () => {
  const [activeRole, setActiveRole] = useState('teacher'); // 'teacher' or 'student'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // ── STEP 1: Authenticate with Supabase Auth ───────────────────────────
      // This establishes a Supabase session, enabling "Forgot Password" to work
      // for anyone who signed up via the new registration flow.
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        // Supabase returns generic errors; translate common ones for clarity.
        if (authError.message.includes('Invalid login credentials')) {
          throw new Error('Invalid email or password. Please try again.');
        }
        throw new Error(authError.message);
      }

      // ── STEP 2: Fetch the user's role & profile from our PostgreSQL API ───
      // Supabase Auth doesn't know about roles (teacher vs student), so we
      // still call our backend which handles the role-based routing logic.
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Pass isSupabaseAuth: true and the supabaseId so the backend matches by UUID
        body: JSON.stringify({ 
          email, 
          password, 
          role: activeRole, 
          isSupabaseAuth: true,
          supabaseId: authData.user.id 
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // If the role check fails, sign out of Supabase to avoid a dangling session
        await supabase.auth.signOut();
        throw new Error(data.error || 'Failed to login');
      }

      // ── Success: save profile to localStorage and route ───────────────────
      localStorage.setItem('user', JSON.stringify(data));

      if (data.role === 'teacher') {
        navigate('/dashboard');
      } else {
        navigate('/student-dashboard');
      }

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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
              type="button"
              className={`role-btn ${activeRole === 'teacher' ? 'active' : ''}`}
              onClick={() => setActiveRole('teacher')}
            >
              Teacher
            </button>
            <button 
              type="button"
              className={`role-btn ${activeRole === 'student' ? 'active' : ''}`}
              onClick={() => setActiveRole('student')}
            >
              Student
            </button>
          </div>

          <form onSubmit={handleLogin}>
            {error && (
              <div style={{
                color: '#dc2626',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                padding: '10px 14px',
                marginBottom: '12px',
                textAlign: 'center',
                fontSize: '0.9rem',
              }}>
                {error}
              </div>
            )}

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

            <button type="submit" className="signin-btn" disabled={loading}>
              {loading ? 'Signing in…' : `Sign In as ${activeRole.charAt(0).toUpperCase() + activeRole.slice(1)}`}
            </button>
          </form>

          <p className="register-text">
            Don't have an account? <Link to="/signup" className="register-link">Register Now</Link>
          </p>

          <p className="login-legal">
            By logging in, you agree to our <a href="/#">Privacy Policy</a> & <a href="/#">Terms of Use</a>.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;