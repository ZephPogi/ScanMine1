import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import logo from '../assets/Logo.png'; // Palitan base sa filename ng logo mo
import './Signup.css';

const Signup = () => {
  const [activeRole, setActiveRole] = useState('teacher');
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      const response = await fetch('http://localhost:5000/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, role: activeRole }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to register');
      }

      alert(`Account created successfully! You can now login.`);
      navigate('/login');
    } catch (err) {
      setError(err.message);
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
             <div className="user-plus-icon">👤+</div>
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
              className={activeRole === 'teacher' ? 'tab active' : 'tab'} 
              onClick={() => setActiveRole('teacher')}
            >
              Teacher
            </button>
            <button 
              className={activeRole === 'student' ? 'tab active' : 'tab'} 
              onClick={() => setActiveRole('student')}
            >
              Student
            </button>
          </div>

          <form onSubmit={handleSignup}>
            {error && <div style={{ color: 'red', marginBottom: '10px', textAlign: 'center' }}>{error}</div>}
            <div className="input-group">
              <div className="input-box">
                <label>Full Name</label>
                <input type="text" placeholder="Juan Dela Cruz" value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div className="input-box">
                <label>Email Address</label>
                <input type="email" placeholder="juan@school.edu" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
            </div>

            <div className="input-box">
              <label>Password</label>
              <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>

            <div className="input-box">
              <label>Confirm Password</label>
              <input type="password" placeholder="••••••••" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
            </div>

            <button type="submit" className="signup-btn">
              Register Account
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