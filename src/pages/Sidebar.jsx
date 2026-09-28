import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, BookOpen, User, LogOut } from 'lucide-react';
import './Sidebar.css';

const Sidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  // Compute initials for the avatar chip
  const nameParts = (user.name || 'Teacher').trim().split(' ');
  const initials = (nameParts[0]?.[0] || 'T') + (nameParts[1]?.[0] || '');

  return (
    <aside className="sidebar">
      {/* ── Brand ── */}
      <div className="sidebar-brand">
        <div className="brand-logo">S</div>
        <h2>ScanMine</h2>
      </div>

      {/* ── User greeting chip ── */}
      <div className="sidebar-user-chip">
        <div className="sidebar-user-avatar">{initials.toUpperCase()}</div>
        <div className="sidebar-user-info">
          <span className="sidebar-user-name">{user.name || 'Teacher'}</span>
          <span className="sidebar-user-role">Teacher</span>
        </div>
      </div>

      {/* ── Navigation ── */}
      <p className="nav-section-label">Menu</p>
      <nav className="sidebar-nav">
        <ul>
          <Link to="/dashboard" style={{ textDecoration: 'none' }}>
            <li className={`nav-item ${location.pathname === '/dashboard' ? 'active' : ''}`}>
              <LayoutDashboard className="icon" size={20} />
              <span>Dashboard</span>
            </li>
          </Link>

          <Link to="/classes" style={{ textDecoration: 'none' }}>
            <li className={`nav-item ${location.pathname === '/classes' ? 'active' : ''}`}>
              <BookOpen className="icon" size={20} />
              <span>My Classes</span>
            </li>
          </Link>

          <Link to="/profile" style={{ textDecoration: 'none' }}>
            <li className={`nav-item ${location.pathname === '/profile' ? 'active' : ''}`}>
              <User className="icon" size={20} />
              <span>Profile</span>
            </li>
          </Link>
        </ul>
      </nav>

      <div className="sidebar-divider" />

      {/* ── Logout ── */}
      <div className="sidebar-footer">
        <div className="nav-item logout" onClick={() => navigate('/login')}>
          <LogOut className="icon" size={20} />
          <span>Logout</span>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;