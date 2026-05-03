import { useState, useEffect, useCallback } from 'react';
import SectionDetails from './SectionDetails';
import Sidebar from './Sidebar';
import { BookOpen, Plus, X, Users } from 'lucide-react';
import './TeacherClass.css';

const TeacherClass = () => {
  const [selectedSection, setSelectedSection] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newClass, setNewClass] = useState({ name: '', subject: '' });
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const fetchClasses = useCallback(async () => {
    try {
      const response = await fetch(`/api/classes?teacherId=${user.id}`);
      if (response.ok) {
        const data = await response.json();
        setClasses(Array.isArray(data) ? data : []);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error fetching classes:', error);
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    if (user.id) {
      fetchClasses();
    } else {
      setLoading(false);
    }
  }, [user.id, fetchClasses]);

  const handleCreateClass = async () => {
    if (!user.id) return alert('Please login again. User session missing.');
    if (!newClass.name) return alert('Please enter a class name');
    
    try {
      const response = await fetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherId: user.id,
          name: newClass.name,
          subject: newClass.subject
        }),
      });

      if (response.ok) {
        const created = await response.json();
        setClasses([...classes, created]);
        setShowCreateModal(false);
        setNewClass({ name: '', subject: '' });
      }
    } catch (error) {
      console.error('Error creating class:', error);
    }
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setNewClass({ name: '', subject: '' });
  };

  if (selectedSection) {
    return <SectionDetails section={selectedSection} onBack={() => setSelectedSection(null)} />;
  }

  return (
    <div className="page-layout">
      <Sidebar />
      <div className="main-content">
        <header className="page-header">
          <h2>My Classes</h2>
          <button className="add-btn" onClick={() => setShowCreateModal(true)}>
            <Plus size={18} />
            <span>Create Class</span>
          </button>
        </header>

        {loading ? (
          <p>Loading classes...</p>
        ) : (
          <div className="class-grid">
            {classes.map((item) => (
              <div key={item.id} className="class-card">
                <div className="card-top">
                  <span className="subject-label">{item.subject || 'No Subject'}</span>
                </div>
                <div className="card-info">
                  <h3>{item.name}</h3>
                  <p><Users size={16} /> View Students & Exams</p>
                </div>
                <button className="view-btn" onClick={() => setSelectedSection(item)}>
                  View Section
                </button>
              </div>
            ))}
            {classes.length === 0 && <p>No classes created yet.</p>}
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="create-modal-overlay" onClick={closeCreateModal}>
          <div className="create-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="create-modal-header">
              <span className="create-prof-label">prof</span>
              <button className="create-close-btn" onClick={closeCreateModal}><X size={20} /></button>
            </div>

            <div className="create-title-banner">
              <BookOpen size={20} />
              <span>Create New Class</span>
            </div>

            <div className="create-form">
              <div className="create-field">
                <label className="create-label">Class / Section Name</label>
                <input
                  type="text"
                  className="create-input"
                  placeholder="e.g. Grade 10 - Rizal"
                  value={newClass.name}
                  onChange={(e) => setNewClass({ ...newClass, name: e.target.value })}
                />
              </div>

              <div className="create-field">
                <label className="create-label">Subject</label>
                <input
                  type="text"
                  className="create-input"
                  placeholder="e.g. Philippine History"
                  value={newClass.subject}
                  onChange={(e) => setNewClass({ ...newClass, subject: e.target.value })}
                />
              </div>
            </div>

            <div className="create-modal-footer">
              <button className="create-submit-btn" onClick={handleCreateClass}>
                Create Class
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherClass;