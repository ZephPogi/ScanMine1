import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import AuthBrandPanel from '../components/AuthBrandPanel';
import './Signup.css';

const Signup = () => {
  const [activeRole, setActiveRole] = useState('teacher');
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState('');
  const [middleInitial, setMiddleInitial] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Computed full name: "Jon Z. Glodoviza" or "Jon Glodoviza" if no MI
  const fullName = [
    firstName.trim(),
    middleInitial.trim() ? `${middleInitial.trim().toUpperCase()}.` : '',
    lastName.trim(),
  ].filter(Boolean).join(' ');

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
            first_name:     firstName.trim(),
            middle_initial: middleInitial.trim().toUpperCase(),
            last_name:      lastName.trim(),
            name:           fullName, // Kept for backward compat with DB trigger
            role:           activeRole,
          },
        },
      });

      if (authError) {
        throw new Error(authError.message);
      }

      if (!data.user) {
        throw new Error('Signup failed. Please try again.');
      }

      if (data.session) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          throw new Error(`Account created, but signing out failed: ${signOutError.message}`);
        }
      }

      try {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Pass isSupabaseAuth: true and the supabaseId so the backend matches by UUID
          body: JSON.stringify({
            email:          email,
            password:       password,
            role:           activeRole,
            isSupabaseAuth: true,
            supabaseId:     data.user.id,
            firstName:      firstName.trim(),
            middleInitial:  middleInitial.trim().toUpperCase(),
            lastName:       lastName.trim(),
            name:           fullName,
          }),
        });

        if (!response.ok) {
          console.warn('Could not sync user profile immediately after signup.');
        }
      } catch (syncError) {
        console.warn('Could not sync user profile immediately after signup.', syncError);
      }

      navigate('/login', {
        state: {
          message: 'Registration successful! Please check your email to verify your account before logging in.',
        },
      });

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="auth-page">
      <AuthBrandPanel />

      {/* RIGHT SIDE: Signup Form */}
      <div className="auth-form-side">
        <div className="auth-form-card">
          <div className="auth-form-header">
            <h2>Create Account</h2>
            <p>Register as a {activeRole} to ScanMine</p>
          </div>

          <div
            role="status"
            className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
            style={{
              backgroundColor: '#ecfdf5',
              border: '1px solid #a7f3d0',
              borderRadius: '8px',
              color: '#065f46',
              fontSize: '0.9rem',
              marginBottom: '12px',
              padding: '10px 14px',
            }}
          >
            Note: After registering, please check your email (including your spam folder) to verify your account before logging in.
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

            {/* ── Row 1: First Name + Middle Initial ── */}
            <div className="name-fields-row">
              <div className="input-box name-first">
                <label>First Name <span className="req-star">*</span></label>
                <input
                  id="signup-first-name"
                  type="text"
                  placeholder="Juan"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div className="input-box name-mi">
                <label>M.I.</label>
                <input
                  id="signup-middle-initial"
                  type="text"
                  placeholder="D"
                  maxLength={1}
                  value={middleInitial}
                  onChange={e => setMiddleInitial(e.target.value.toUpperCase())}
                />
              </div>
            </div>

            {/* ── Row 2: Last Name ── */}
            <div className="input-box">
              <label>Last Name <span className="req-star">*</span></label>
              <input
                id="signup-last-name"
                type="text"
                placeholder="Dela Cruz"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                required
              />
            </div>

            {/* ── Row 3: Email ── */}
            <div className="input-box">
              <label>Email Address <span className="req-star">*</span></label>
              <input
                id="signup-email"
                type="email"
                placeholder="juan@school.edu"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
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
            {' · '}
            <Link to="/forgot-password">Forgot Password?</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Signup;