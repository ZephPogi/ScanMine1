import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import logo from '../assets/Logo.png';
import { supabase } from '../supabaseClient';
import './Signup.css';

const Signup = () => {
  const [activeRole, setActiveRole] = useState('teacher');
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);

    try {
      // ── Single step: Supabase Auth + DB trigger handles everything ────────
      // The database trigger automatically syncs this user into the
      // public.users (PostgreSQL) table using the metadata below.
      const { data, error: authError } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            name: name,       // Full name from the form — passed to the DB trigger
            role: activeRole, // 'teacher' or 'student' — passed to the DB trigger
          },
        },
      });

      if (authError) {
        throw new Error(authError.message);
      }

      if (!data.user) {
        throw new Error('Signup failed. Please try again.');
      }

      // ── Redirect to the correct dashboard based on selected role ──────────
      // Supabase auto-signs in on signUp. We need to fetch the newly created 
      // PostgreSQL user profile (created by the DB trigger) to store in localStorage
      // so the dashboards can access the user's database ID and role.
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Pass isSupabaseAuth: true so the backend skips the local password check
        body: JSON.stringify({ email: email, password: password, role: activeRole, isSupabaseAuth: true }),
      });

      if (response.ok) {
        const userData = await response.json();
        localStorage.setItem('user', JSON.stringify(userData));
      } else {
        // If the trigger was slightly delayed or failed, provide a fallback.
        console.warn('Could not fetch user profile immediately after signup.');
        // We could sign them out, but we'll try to just let them proceed for now.
        // Or better, set a fallback object so the dashboard doesn't completely crash.
        localStorage.setItem('user', JSON.stringify({ name: name, role: activeRole, email: email }));
      }

      if (activeRole === 'teacher') {
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
    <div className="signup-container">
      {/* LEFT SIDE: Branding */}
      <div className="signup-left">
        <div className="branding-content">
          <div className="logo-section">
            <img src={logo} alt="ScanMine Logo" className="app-logo" />
            <h1 className="brand-text">ScanMine</h1>
          </div>
          <p className="tagline">
            Join the future of classroom automation. <br />
            <span>Create your account to get started.</span>
          </p>
          
          <div className="visual-box-signup">
             <div className="pulse-circle"></div>
             <div className="user-plus-icon"><UserPlus size={48} /></div>
          </div>
        </div>
      </div>

      {/* RIGHT SIDE: Signup Form */}
      <div className="signup-right">
        <div className="form-container">
          <div className="welcome-msg">
            <h2>Create Account</h2>
            <p>Register as a {activeRole} to ScanMine</p>
          </div>

          <div className="role-tabs">
            <button 
              type="button"
              className={activeRole === 'teacher' ? 'tab active' : 'tab'} 
              onClick={() => setActiveRole('teacher')}
            >
              Teacher
            </button>
            <button 
              type="button"
              className={activeRole === 'student' ? 'tab active' : 'tab'} 
              onClick={() => setActiveRole('student')}
            >
              Student
            </button>
          </div>

          <form onSubmit={handleSignup}>
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
              <div className="input-box">
                <label>Full Name</label>
                <input
                  type="text"
                  placeholder="Juan Dela Cruz"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              </div>
              <div className="input-box">
                <label>Email Address</label>
                <input
                  type="email"
                  placeholder="juan@school.edu"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="input-box">
              <label>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            <div className="input-box">
              <label>Confirm Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            <button type="submit" className="signup-btn" disabled={loading}>
              {loading ? 'Creating Account…' : 'Register Account'}
            </button>
          </form>

          <p className="login-link">
            Already have an account? <Link to="/login">Login here</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Signup;