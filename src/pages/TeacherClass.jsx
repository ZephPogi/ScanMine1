import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import SectionDetails from './SectionDetails';
import Sidebar from './Sidebar';
import { BookOpen, Plus, X, Users, Trash2, Copy, Check, Loader2, AlertTriangle, Eye } from 'lucide-react';
import './TeacherClass.css';

const TeacherClass = () => {
  const location = useLocation();
  const [selectedSection, setSelectedSection] = useState(() => location.state?.section || null);
  const [openQuizOnSelectedSection, setOpenQuizOnSelectedSection] = useState(() => Boolean(location.state?.openQuizGenerator));
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newClass, setNewClass] = useState({ name: '', subject: '' });
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  // ── Delete confirmation modal state ─────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, name, subject }

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

    setIsCreating(true);
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
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteClass = async (classId, e) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this class? This action cannot be undone and will remove all associated exams and students.")) {
      return;
    }

    try {
      const response = await fetch(`/api/classes/${classId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setClasses(prev => prev.filter(c => c.id !== classId));
      } else {
        alert("Failed to delete class");
      }
    } catch (error) {
      console.error('Error deleting class:', error);
      alert("Error deleting class");
    }
  };

  // ── Styled delete: opens confirmation modal ──────────────────────────────
  const openDeleteModal = (e, cls) => {
    e.stopPropagation();
    setDeleteTarget(cls);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const fakeEvent = { stopPropagation: () => {} };
    await handleDeleteClass(deleteTarget.id, fakeEvent);
    setDeleteTarget(null);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setNewClass({ name: '', subject: '' });
  };

  const handleCopyCode = (e, cls) => {
    e.stopPropagation();
    if (!cls.class_code) return;
    navigator.clipboard.writeText(cls.class_code);
    setCopiedId(cls.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (selectedSection) {
    return (
      <SectionDetails
        section={selectedSection}
        initialOpenQuizGenerator={openQuizOnSelectedSection}
        onBack={() => {
          setSelectedSection(null);
          setOpenQuizOnSelectedSection(false);
        }}
      />
    );
  }

  return (
    <div className="page-layout">
      <Sidebar />
      <div className="main-content">
        {/* ── Page Header ── */}
        <header className="page-header">
          <div className="page-header-text">
            <h2>My Classes</h2>
            <p>Manage your class sections and students.</p>
          </div>
          <button className="add-btn" onClick={() => setShowCreateModal(true)}>
            <Plus size={18} />
            <span>Create New Class</span>
          </button>
        </header>

        {/* ── Class Grid ── */}
        {loading ? (
          <div className="loading-state">
            <Loader2 size={22} className="spin" />
            Loading your classes…
          </div>
        ) : (
          <div className="class-grid">
            {classes.length === 0 ? (
              <div className="empty-state-card">
                <div className="empty-state-icon-large">
                  <BookOpen size={34} />
                </div>
                <h3>No Classes Yet</h3>
                <p>Get started by creating your first class section.</p>
                <button className="add-btn" onClick={() => setShowCreateModal(true)}>
                  <Plus size={16} />
                  Create New Class
                </button>
              </div>
            ) : (
              classes.map((item) => (
                <div key={item.id} className="class-card">
                  <div className="card-gradient-strip" />
                  <div className="card-body">
                    <div className="card-top">
                      <span className="subject-label">{item.name || 'No Section'}</span>
                      <div className="card-top-actions">
                        {item.class_code && (
                          <button
                            className="copy-code-btn"
                            onClick={(e) => handleCopyCode(e, item)}
                            title="Copy class code"
                          >
                            {copiedId === item.id
                              ? <><Check size={13} /><span>Copied!</span></>
                              : <><Copy size={13} /><span>{item.class_code}</span></>}
                          </button>
                        )}
                        <button
                          className="delete-class-btn"
                          onClick={(e) => openDeleteModal(e, item)}
                          title="Delete Class"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="card-info">
                      <h3>{item.subject || 'No Subject'}</h3>
                      <div className="card-info-meta">
                        <Users size={14} />
                        <span>View Students &amp; Exams</span>
                      </div>
                    </div>
                    <button className="view-btn" onClick={() => setSelectedSection(item)}>
                      <Eye size={16} />
                      View Section
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Create Class Modal ── */}
      {showCreateModal && (
        <div className="create-modal-overlay" onClick={closeCreateModal}>
          <div className="create-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="create-modal-header">
              <span className="create-prof-label">Teacher</span>
              <button className="create-close-btn" onClick={closeCreateModal}><X size={18} /></button>
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
              <button className="create-submit-btn" onClick={handleCreateClass} disabled={isCreating}>
                {isCreating ? (
                  <><Loader2 size={17} className="btn-spinner" /> Creating…</>
                ) : (
                  <><Plus size={17} /> Create Class</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div className="delete-modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="delete-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="delete-modal-icon">
              <AlertTriangle size={30} />
            </div>
            <h3>Delete Class?</h3>
            <p>You are about to permanently delete:</p>
            <span className="delete-class-name">
              {deleteTarget.subject || deleteTarget.name || 'This Class'}
            </span>
            <p>This will remove all associated exams and student records. This action <strong>cannot be undone</strong>.</p>
            <div className="delete-modal-actions">
              <button className="delete-cancel-btn" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button className="delete-confirm-btn" onClick={confirmDelete}>
                <Trash2 size={15} />
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherClass;