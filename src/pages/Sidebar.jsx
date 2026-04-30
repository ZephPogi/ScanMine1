import { Link, useLocation, useNavigate } from 'react-router-dom';
import './Sidebar.css';

const Sidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-logo">S</div>
        <h2>ScanMine</h2>
      </div>
      
      <nav className="sidebar-nav">
        <ul>
          {/* Dashboard */}
          <Link to="/dashboard" style={{ textDecoration: 'none' }}>
            <li className={`nav-item ${location.pathname === '/dashboard' ? 'active' : ''}`}>
              <span className="icon">&#8962;</span> Dashboard
            </li>
          </Link>

          {/* My Classes */}
          <Link to="/classes" style={{ textDecoration: 'none' }}>
            <li className={`nav-item ${location.pathname === '/classes' ? 'active' : ''}`}>
              <span className="icon">&#128218;</span> My Classes
            </li>
          </Link>

          {/* Profile */}
          <Link to="/profile" style={{ textDecoration: 'none' }}>
            <li className={`nav-item ${location.pathname === '/profile' ? 'active' : ''}`}>
              <span className="icon">&#128100;</span> Profile
            </li>
          </Link>
        </ul>
      </nav>

      <div className="sidebar-footer">
        <div className="nav-item logout" onClick={() => navigate('/login')}>
          <span className="icon">&#128682;</span> Logout
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;