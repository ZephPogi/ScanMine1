import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import AuthBrandPanel from '../components/AuthBrandPanel';
import './Login.css';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [showLegal, setShowLegal] = useState(false);

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
      localStorage.setItem('user', JSON.stringify(data.user || data));

      const userRole = data.user?.role || data.role; // Extract the role from the backend response

      if (userRole === 'teacher') {
        navigate('/dashboard'); // Route to Teacher Dashboard
      } else if (userRole === 'student') {
        navigate('/student-dashboard'); // Route to Student Dashboard
      } else {
        navigate('/'); // Fallback
      }

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <AuthBrandPanel />

      {/* RIGHT SIDE: Login Form */}
      <div className="auth-form-side">
        <div className="auth-form-card">
          <div className="auth-form-header">
            <h2>Welcome Back</h2>
            <p>Please log in to your account.</p>
          </div>



          <form onSubmit={handleLogin}>
            {error && (
              <div className="error-banner">
                {error}
              </div>
            )}

            <div className="input-group">
              <label>Email Address</label>
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
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <p className="register-text">
            Don't have an account? <Link to="/signup" className="register-link">Register Now</Link>
          </p>

          <p className="login-legal">
            By logging in, you agree to our{' '}
            <span onClick={() => setShowLegal(true)} style={{ cursor: 'pointer', textDecoration: 'underline' }}>
              Privacy Policy & Terms of Use
            </span>.
          </p>
        </div>
      </div>

      {showLegal && (
        <div className="legal-modal-overlay" onClick={() => setShowLegal(false)}>
          <div className="legal-modal-content" onClick={e => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setShowLegal(false)}>×</button>
            <h2>Privacy Policy & Terms of Use</h2>
            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <h3 style={{ marginTop: 0 }}>ScanMine Privacy Policy</h3>
              <p><strong>1. Data Collection:</strong> ScanMine (developed by JoJu Informatics) collects user information including names, faculty emails, and student rosters to facilitate automated grading. When using the scanner, images of physical answer sheets are processed using our Optical Recognition (OCR) engine.</p>
              <p><strong>2. Data Usage:</strong> Extracted data is strictly used to evaluate student performance, generate quizzes via our rule-based algorithm, and maintain class records.</p>
              <p><strong>3. Data Storage & Security:</strong> Authentication and database records are securely managed via Supabase and PostgreSQL. We do not sell your personal data or student records to third parties.</p>
              <p><strong>4. User Rights:</strong> Educators may delete exam records, OCR scans, and student data from their dashboards at any time.</p>
              <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid #ccc' }} />
              <h3>ScanMine Terms of Use</h3>
              <p><strong>1. Acceptance of Terms:</strong> By registering as a Teacher or Student, you agree to these terms. ScanMine is an educational utility designed to assist with grading workflow.</p>
              <p><strong>2. System Accuracy:</strong> While our OCR and Computer Vision engines are highly optimized, physical document damage, poor lighting, or illegible handwriting may affect extraction accuracy. Educators are responsible for reviewing auto-graded results before finalizing them.</p>
              <p><strong>3. Intellectual Property:</strong> The ScanMine system architecture, UI/UX, and rule-based generation algorithms are the intellectual property of JoJu Informatics.</p>
              <p><strong>4. Acceptable Use:</strong> Users agree not to attempt to breach the Supabase authentication layer, upload malicious files disguised as Answer Keys, or use the platform for non-educational purposes.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;