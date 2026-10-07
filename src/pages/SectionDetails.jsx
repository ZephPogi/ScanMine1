/* eslint-disable */
import { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, Search, UserPlus, UserMinus, Download, Camera, Edit, Sparkles, Eye, Upload, X, Check, Pencil } from 'lucide-react';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { supabase } from '../supabaseClient';
import './SectionDetails.css';
import Sidebar from './Sidebar';

// --- THE SMART PARSER ---
// --- HELPER: Strip duplicated "Answer:" prefixes (e.g. "Answer: Answer: C" -> "C") ---
const cleanAnswer = (ans) => {
  if (!ans) return '';
  return String(ans).replace(/^(?:Answer:\s*)+/i, '').trim();
};

const getMultipleChoiceDetails = (question) => {
  const optionLetters = ['A', 'B', 'C', 'D'];
  const options = Array.isArray(question?.options)
    ? question.options.map(option => (
      typeof option === 'string' ? option.replace(/^\s*[A-D]\s*[.)]\s*/i, '').trim() : ''
    ))
    : [];
  const rawAnswer = cleanAnswer(question?.correctAnswer ?? question?.correct_answer ?? question?.answer_text);
  const letterMatch = rawAnswer.match(/^([A-D])(?:\s*[).:-]|\s*\(|$)/i);
  let optionIndex = letterMatch ? optionLetters.indexOf(letterMatch[1].toUpperCase()) : -1;

  if (optionIndex < 0 && rawAnswer) {
    const normalizedAnswer = rawAnswer.toLowerCase();
    optionIndex = options.findIndex(option => option && option.toLowerCase() === normalizedAnswer);
    if (optionIndex < 0) {
      optionIndex = options.findIndex(option => option
        && (option.toLowerCase().includes(normalizedAnswer) || normalizedAnswer.includes(option.toLowerCase())));
    }
  }

  const letter = optionIndex >= 0 && optionIndex < optionLetters.length
    ? optionLetters[optionIndex]
    : (letterMatch ? letterMatch[1].toUpperCase() : '');
  const answer = letter
    ? `${letter}${options[optionIndex] ? ` (${options[optionIndex]})` : ''}`
    : (rawAnswer || 'N/A');

  return { answer, letter, optionIndex, options };
};

const normalizeMultipleChoiceQuestion = (question) => {
  if (question?.type !== 'multiple_choice') return question;

  const details = getMultipleChoiceDetails(question);
  if (!/^[A-D]$/.test(details.letter)) {
    throw new Error(`Could not map the multiple-choice answer for "${question.question || question.question_text || 'a question'}" to an option letter.`);
  }

  return {
    ...question,
    options: details.options,
    correctAnswer: details.letter
  };
};

const wakeHuggingFaceSpace = () => {
  fetch('https://zephpogi-scanmine-trocr.hf.space/', { mode: 'no-cors' })
    .then(() => console.log('🔥 [Pre-Warm] Sent wakeup ping to Hugging Face Space'))
    .catch((err) => console.log('🔥 [Pre-Warm] Ping initiated:', err.message));
};

const parseScanMineText = (rawText) => {
  if (!rawText) return [];
  let currentCandidate = null;
  const parsedQuestions = [];
  const lines = rawText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Skip Multiple Choice options and Headers
    if (line.match(/^[A-D]\)/) || line.startsWith('PART') || line.startsWith('Note:')) {
      continue;
    }

    // The Anchor Split: Hunt for the Number + Dot anywhere in the line
    const anchorMatch = line.match(/(\d+)\s*\.\s*(.*)/);

    if (anchorMatch) {
      const questionNum = parseInt(anchorMatch[1], 10);
      const questionText = anchorMatch[2].trim();
      const rawAnswer = line.substring(0, anchorMatch.index).trim();
      const resolvedAnswer = rawAnswer ? rawAnswer : (currentCandidate || "?");

      parsedQuestions.push({
        questionText: questionText,
        correctAnswer: cleanAnswer(resolvedAnswer)
      });

      currentCandidate = null;
      continue;
    }
    currentCandidate = line;
  }
  return parsedQuestions;
};

const SectionDetails = ({ section, onBack }) => {
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [showExamDetails, setShowExamDetails] = useState(null);
  const [examQuestions, setExamQuestions] = useState({ manual: [], generated: [] });
  const [examFile, setExamFile] = useState(null);
  const [manualAnswers, setManualAnswers] = useState('');
  const [examTitle, setExamTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [answerKeyImage, setAnswerKeyImage] = useState(null);
  const [isProcessingOCR, setIsProcessingOCR] = useState(false);

  const [parsedOCRData, setParsedOCRData] = useState(null);
  const [formattedAnswersToSave, setFormattedAnswersToSave] = useState('');

  const [showQuizGeneratorModal, setShowQuizGeneratorModal] = useState(false);
  const [quizLessonFile, setQuizLessonFile] = useState(null);
  const [numberOfQuestions, setNumberOfQuestions] = useState(10);
  const [generatedQuestions, setGeneratedQuestions] = useState([]);
  const [generatedExamId, setGeneratedExamId] = useState(null);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [isSavingQuiz, setIsSavingQuiz] = useState(false);
  const [quizError, setQuizError] = useState('');
  const [questionTypes, setQuestionTypes] = useState(['multiple_choice', 'true_false', 'identification']);
  const [customPrompt, setCustomPrompt] = useState('');
  const [examSubmissions, setExamSubmissions] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentSubmissions, setStudentSubmissions] = useState([]);
  const [isEditingStudentName, setIsEditingStudentName] = useState(false);
  const [studentNameDraft, setStudentNameDraft] = useState('');
  const [studentNameSaving, setStudentNameSaving] = useState(false);
  const [studentNameError, setStudentNameError] = useState('');

  // ── Selected exam highlight (tap/active state) ─────────────────────────
  const [selectedExamId, setSelectedExamId] = useState(null);

  // ── Invite search state ────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef(null);

  const examInputRef = useRef(null);
  const answerKeyInputRef = useRef(null);
  const quizFileRef = useRef(null);

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    const anyModalOpen = showAttachModal || showExamDetails || showQuizGeneratorModal;
    if (anyModalOpen) {
      wakeHuggingFaceSpace();
    }
  }, [showAttachModal, showExamDetails, showQuizGeneratorModal]);

  const fetchStudents = useCallback(async () => {
    try {
      const response = await fetch(`/api/classes/${section?.id}/students`);
      if (response.ok) {
        const data = await response.json();
        setStudents(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching students:', error);
    }
  }, [section?.id]);

  const fetchExams = useCallback(async () => {
    try {
      const response = await fetch(`/api/exams?classId=${section?.id}`);
      if (response.ok) {
        const data = await response.json();
        setExams(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching exams:', error);
    }
  }, [section?.id]);

  useEffect(() => {
    if (section?.id) {
      fetchStudents();
      fetchExams();
    }
  }, [section?.id, fetchStudents, fetchExams]);

  if (!section) return null;

  const handleViewExam = async (exam) => {
    if (!exam) return;
    setShowExamDetails(exam);
    setParsedOCRData(null);
    setExamSubmissions([]);
    try {
      // Fetch questions
      const qRes = await fetch(`/api/exams/${exam.id}/questions`);
      if (qRes.ok) {
        const qData = await qRes.json();
        setExamQuestions(qData || { manual: [], generated: [] });
      }

      // Fetch submissions for this exam
      const subRes = await fetch(`/api/exams/${exam.id}/submissions`);
      if (subRes.ok) {
        const subData = await subRes.json();
        setExamSubmissions(subData || []);
      }
    } catch (error) {
      console.error('Error fetching exam details:', error);
    }
  };

  const handleViewStudent = async (student) => {
    if (!student) return;
    setSelectedStudent(student);
    setStudentSubmissions([]);
    setIsEditingStudentName(false);
    setStudentNameDraft(student.name || '');
    setStudentNameError('');
    try {
      const response = await fetch(`/api/student/${student.user_id}/grades/${section.id}`);
      if (response.ok) {
        const data = await response.json();
        setStudentSubmissions(data || []);
      }
    } catch (error) {
      console.error('Error fetching student grades:', error);
    }
  };

  const handleSaveStudentName = async (event) => {
    event.preventDefault();
    const normalizedName = studentNameDraft.trim().replace(/\s+/g, ' ');
    if (!normalizedName) {
      setStudentNameError('Student name cannot be empty.');
      return;
    }

    setStudentNameSaving(true);
    setStudentNameError('');
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error('Your session has expired. Please sign in again.');

      const response = await fetch(`/api/students/${selectedStudent.user_id}/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ classId: section.id, name: normalizedName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update student name');

      setSelectedStudent((current) => ({ ...current, ...data.user }));
      setStudents((current) => current.map((student) => (
        String(student.user_id) === String(selectedStudent.user_id)
          ? { ...student, name: data.user.name }
          : student
      )));
      setStudentNameDraft(data.user.name);
      setIsEditingStudentName(false);
    } catch (error) {
      setStudentNameError(error.message || 'Failed to update student name.');
    } finally {
      setStudentNameSaving(false);
    }
  };

  const handleDeleteExam = async (e, examId) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this exam? All student results for this exam will also be deleted.')) return;

    try {
      const response = await fetch(`/api/exams/${examId}`, { method: 'DELETE' });
      if (response.ok) {
        fetchExams();
        if (showExamDetails?.id === examId) setShowExamDetails(null);
      }
    } catch (error) {
      console.error('Error deleting exam:', error);
    }
  };

  const handleSearchStudents = useCallback(async (query) => {
    if (query.trim().length < 2) { setSearchResults([]); return; }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/students/search?q=${encodeURIComponent(query.trim())}&classId=${section?.id}`);
      if (res.ok) setSearchResults(await res.json());
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  }, [section?.id]);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => handleSearchStudents(val), 300);
  };

  const handleInviteStudent = async (student) => {
    try {
      const res = await fetch('/api/class/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: section.id, userId: student.id }),
      });
      if (res.ok) {
        setSearchQuery('');
        setSearchResults([]);
        fetchStudents();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to send invite');
      }
    } catch (err) {
      console.error('Invite error:', err);
    }
  };

  const handleKickStudent = async (student) => {
    if (!window.confirm(`Remove ${student.name} from this class?`)) return;
    try {
      const res = await fetch(`/api/class/decline-invite?classId=${section.id}&userId=${student.user_id}`, { method: 'DELETE' });
      if (res.ok) fetchStudents();
      else { const err = await res.json(); alert(err.error || 'Failed to remove student'); }
    } catch (err) {
      console.error('Kick error:', err);
    }
  };

  const handleExamFileChange = (e) => {
    if (e.target.files && e.target.files[0]) setExamFile(e.target.files[0]);
  };

  const handleAnswerKeyImageChange = (e) => {
    if (e.target.files && e.target.files[0]) setAnswerKeyImage(e.target.files[0]);
  };

  const handleProcessOCR = async (examId) => {
    if (!answerKeyImage) return alert('Please select an answer key image first');

    setIsProcessingOCR(true);
    try {
      const formData = new FormData();
      formData.append('image', answerKeyImage);
      formData.append('examId', examId);

      const response = await fetch('/api/test-ocr', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (response.ok && data?.text) {
        alert('OCR processed successfully!');

        const structuredData = parseScanMineText(data.text);
        setParsedOCRData(structuredData);

        const finalAnswersString = structuredData.map(q => q?.correctAnswer || '').join(', ');
        setFormattedAnswersToSave(finalAnswersString);

        // Keep answerKeyImage visible so user can preview the PDF/Image while reviewing answers
      } else {
        alert('OCR processing failed: ' + (data?.error || 'No text extracted.'));
      }
    } catch (error) {
      console.error('OCR error:', error);
      alert('Error processing OCR: ' + (error?.message || 'Unknown error'));
    } finally {
      setIsProcessingOCR(false);
    }
  };

  const handleSaveOCRToDatabase = async () => {
    // CHANGE: Check for parsedOCRData instead of formattedAnswersToSave
    if (!parsedOCRData || parsedOCRData.length === 0 || !showExamDetails?.id) {
      return alert('No valid OCR data to save');
    }

    try {
      // Upload file to storage first to get the URL
      let pdfUrl = null;
      if (answerKeyImage) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', answerKeyImage);
        uploadFormData.append('examId', showExamDetails.id);

        const uploadResponse = await fetch('/api/upload-answer-key-file', {
          method: 'POST',
          body: uploadFormData
        });

        if (uploadResponse.ok) {
          const uploadData = await uploadResponse.json();
          pdfUrl = uploadData.publicUrl;
        }
      }

      const response = await fetch('/api/upload-answer-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          examId: showExamDetails.id,
          // CHANGE: Send the structured array directly!
          answers: parsedOCRData,
          pdfUrl: pdfUrl
        })
      });

      if (response.ok) {
        const result = await response.json();
        alert(result.message); // Will now say "Successfully saved X answers!"

        // Refresh UI
        const questionsResponse = await fetch(`/api/exams/${showExamDetails.id}/questions`);
        if (questionsResponse.ok) {
          const questionsData = await questionsResponse.json();
          setExamQuestions(questionsData || { manual: [], generated: [] });
        }
        setParsedOCRData(null);
        setAnswerKeyImage(null); // Clear file after successful save
      } else {
        const errorData = await response.json();
        alert('Failed to save: ' + (errorData?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error saving OCR to database:', error);
      alert('Error saving answer key: ' + (error?.message || 'Unknown error'));
    }
  };

  const handleSaveAndAssign = async () => {
    if (!examTitle) return alert('Please enter an exam title');

    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.append('teacherId', user?.id || '');
      formData.append('classId', section?.id || '');
      formData.append('title', examTitle);
      if (examFile) formData.append('lessonFile', examFile);

      const examResponse = await fetch('/api/generate-quiz', {
        method: 'POST',
        body: formData
      });

      const examData = await examResponse.json();

      if (!examResponse.ok) {
        throw new Error(examData?.error || 'Failed to save exam');
      }

      if (examData?.examId && manualAnswers) {
        await fetch('/api/upload-answer-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            examId: examData.examId,
            answers: manualAnswers
          })
        });
      }

      alert('Exam and Key saved successfully!');
      fetchExams();
      closeModal();
    } catch (error) {
      console.error('Error saving exam/key:', error);
      alert('Save failed: ' + (error?.message || 'Unknown error'));
    } finally {
      setIsSaving(false);
    }
  };

  const closeModal = () => {
    if (isSaving) return;
    setShowAttachModal(false);
    setExamFile(null);
    setManualAnswers('');
    setAnswerKeyImage(null);
  };

  const handleQuizFileChange = (e) => {
    if (e.target.files && e.target.files[0]) setQuizLessonFile(e.target.files[0]);
  };

  const closeQuizGeneratorModal = () => {
    if (isGeneratingQuiz || isSavingQuiz) return;
    setShowQuizGeneratorModal(false);
    setQuizLessonFile(null);
    setGeneratedQuestions([]);
    setGeneratedExamId(null);
    setQuizError('');
    setCustomPrompt('');
    setNumberOfQuestions(10);
    setQuestionTypes(['multiple_choice', 'true_false', 'identification']);
    if (quizFileRef.current) quizFileRef.current.value = '';
  };

  const parseJsonSafe = async (response) => {
    try {
      return await response.json();
    } catch {
      return {};
    }
  };

  const handleGenerateQuiz = async () => {
    if (!quizLessonFile) {
      setQuizError('Please select a lesson PDF file first.');
      return;
    }
    if (!examTitle) {
      setQuizError('Please enter an exam title.');
      return;
    }
    if (questionTypes.length === 0) {
      setQuizError('Please select at least one question type.');
      return;
    }

    setQuizError('');
    setGeneratedQuestions([]);
    setGeneratedExamId(null);
    setIsGeneratingQuiz(true);
    try {
      const formData = new FormData();
      formData.append('lessonFile', quizLessonFile);
      formData.append('teacherId', user?.id || '');
      formData.append('classId', section?.id || '');
      formData.append('title', examTitle);
      formData.append('numberOfQuestions', String(numberOfQuestions));
      formData.append('questionTypes', JSON.stringify(questionTypes));
      formData.append('customPrompt', customPrompt.trim());

      const response = await fetch('/api/generate-quiz', {
        method: 'POST',
        body: formData
      });

      const data = await parseJsonSafe(response);
      if (!response.ok) {
        throw new Error(data?.error || 'Quiz generation failed. Please try again.');
      }

      const questions = Array.isArray(data?.questions) ? data.questions : [];
      if (questions.length === 0) {
        throw new Error('No questions were generated. Try a different PDF or prompt.');
      }

      setGeneratedQuestions(questions);
      setGeneratedExamId(data?.examId || null);
    } catch (error) {
      console.error('Quiz generation error:', error);
      setQuizError(error?.message || 'Error generating quiz.');
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  const handleSaveAndAssignQuiz = async () => {
    if (generatedQuestions.length === 0) {
      setQuizError('Generate a quiz before saving and assigning it to the class.');
      return;
    }

    setQuizError('');
    setIsSavingQuiz(true);
    try {
      const normalizedQuestions = generatedQuestions.map(normalizeMultipleChoiceQuestion);
      const answers = normalizedQuestions.map((q, i) => ({
        questionText: q.question || q.question_text || `Question ${i + 1}`,
        correctAnswer: q.correctAnswer || q.answer_text || '',
        type: q.type,
        options: q.options
      }));

      const payload = {
        examId: generatedExamId,
        teacherId: user?.id || '',
        classId: section?.id || '',
        title: examTitle,
        questions: normalizedQuestions,
        answers
      };

      let response = await fetch('/api/save-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.status === 404) {
        if (!generatedExamId) {
          throw new Error('Missing exam ID. Generate the quiz again before saving.');
        }
        response = await fetch('/api/upload-answer-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ examId: generatedExamId, answers })
        });
      }

      const data = await parseJsonSafe(response);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save and assign quiz.');
      }

      await fetchExams();
      setShowQuizGeneratorModal(false);
      setQuizLessonFile(null);
      setGeneratedQuestions([]);
      setGeneratedExamId(null);
      setQuizError('');
      setCustomPrompt('');
      if (quizFileRef.current) quizFileRef.current.value = '';
    } catch (error) {
      console.error('Save quiz error:', error);
      setQuizError(error?.message || 'Error saving quiz.');
    } finally {
      setIsSavingQuiz(false);
    }
  };

  const toggleQuestionType = (type) => {
    setQuestionTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const handleDownloadAnswerKey = () => {
    if (generatedQuestions.length === 0) return alert('No questions to download');

    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('ScanMine Answer Key', 105, 20, { align: 'center' });
    doc.setFontSize(12);

    let yPosition = 40;
    generatedQuestions.forEach((q, index) => {
      const ans = q.type === 'multiple_choice'
        ? getMultipleChoiceDetails(q).answer
        : cleanAnswer(q.correctAnswer || q.answer_text || '');
      const qText = q.question || q.question_text || `Question ${index + 1}`;
      const line = `${ans.padEnd(15)} ${index + 1}. ${qText}`;
      doc.text(line, 20, yPosition);
      yPosition += 10;

      if (yPosition > 280) {
        doc.addPage();
        yPosition = 20;
      }
    });

    doc.save('ScanMine-Answer-Key.pdf');
  };

  const handleExportExcel = () => {
    if (!showExamDetails || !students.length) return;

    const gradedStudents = students.filter(s =>
      s.status === 'enrolled' &&
      examSubmissions.some(sub => sub.student_id === s.user_id)
    );

    const pendingStudents = students.filter(s =>
      s.status === 'enrolled' &&
      !examSubmissions.some(sub => sub.student_id === s.user_id)
    );

    const excelData = [
      ...gradedStudents.map(s => {
        const sub = examSubmissions.find(sub => sub.student_id === s.user_id);
        return {
          'Subject': section.subject,
          'Section': section.name,
          'Exam Name': showExamDetails.title,
          'Student Name': s.name,
          'Status': 'Graded',
          'Points Earned': sub?.points_earned ?? 0,
          'Total Points': sub?.total_items ?? 0,
          'Formatted Score': `'${sub?.points_earned ?? 0}/${sub?.total_items ?? 0}`
        };
      }),
      ...pendingStudents.map(s => ({
        'Subject': section.subject,
        'Section': section.name,
        'Exam Name': showExamDetails.title,
        'Student Name': s.name,
        'Status': 'Pending',
        'Points Earned': 0,
        'Total Points': 0,
        'Formatted Score': 'Pending'
      }))
    ];

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Grades");

    // Auto-size columns (rough approximation)
    const maxWidths = excelData.reduce((acc, row) => {
      Object.keys(row).forEach((key, i) => {
        const val = String(row[key]);
        acc[i] = Math.max(acc[i] || 10, val.length, key.length);
      });
      return acc;
    }, []);
    worksheet['!cols'] = maxWidths.map(w => ({ wch: w + 2 }));

    XLSX.writeFile(workbook, `${section.name}_${showExamDetails.title}_Grades.xlsx`);
  };

  return (
    <div className="page-layout">
      <Sidebar />
      <div className="section-container">
        <header className="minimal-header">
          <button className="back-btn" onClick={onBack}>← Back to Classes</button>
          <div className="subject-title">
            <h1>{section?.name || 'Class Details'}</h1>
            <p>{section?.subject || ''}</p>
          </div>
        </header>

        <div className="section-grid">
          <section className="roster-section">
            <div className="card-header">
              <h3>Student Roster
                <span className="roster-count">{students.length}</span>
              </h3>
            </div>

            {/* ── Inline Search / Invite Bar ── */}
            <div className="invite-search-wrapper">
              <div className="invite-search-bar">
                <Search size={16} className="search-icon" />
                <input
                  type="text"
                  className="invite-search-input"
                  placeholder="Search students by name or email to invite…"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  autoComplete="off"
                />
                {searchQuery && (
                  <button className="search-clear-btn" onClick={() => { setSearchQuery(''); setSearchResults([]); }}>×</button>
                )}
              </div>
              {(searchResults.length > 0 || (isSearching && searchQuery.length >= 2)) && (
                <div className="search-results-dropdown">
                  {isSearching ? (
                    <div className="search-result-loading">Searching…</div>
                  ) : searchResults.length === 0 ? (
                    <div className="search-result-empty">No students found</div>
                  ) : (
                    searchResults.map(s => (
                      <div key={s.id} className="search-result-item">
                        <div className="search-result-info">
                          <span className="search-result-name">{s.name}</span>
                          <span className="search-result-email">{s.email}</span>
                        </div>
                        <button className="invite-btn" onClick={() => handleInviteStudent(s)}>
                          <UserPlus size={14} />
                          Invite
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="table-responsive-wrapper">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {students && students.length > 0 ? (
                    students.map((s, idx) => s ? (
                      <tr
                        key={s.user_id || `student-${idx}`}
                        onClick={() => handleViewStudent(s)}
                        style={{ cursor: 'pointer' }}
                        className="roster-row-hover"
                      >
                        <td className="student-name">{s.name || 'Unknown'}</td>
                        <td>{s.email || 'N/A'}</td>
                        <td>
                          <span className={`status-badge ${s.status === 'enrolled' ? 'badge-enrolled' : 'badge-pending'}`}>
                            {s.status === 'enrolled' ? 'Enrolled' : 'Pending'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="kick-btn"
                            title="Remove student"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleKickStudent(s);
                            }}
                          >
                            <UserMinus size={15} />
                          </button>
                        </td>
                      </tr>
                    ) : null)
                  ) : (
                    <tr><td colSpan="4" style={{ textAlign: 'center', color: '#94a3b8', padding: '20px' }}>No students yet. Use the search bar above to invite them.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="actions-sidebar">
            <div className="action-card exam-management">
              <h4>Exam Management</h4>
              <button className="btn-action primary" onClick={() => {
                wakeHuggingFaceSpace();
                setShowAttachModal(true);
              }}>
                Attach Exam & Key
              </button>
              <button className="btn-action success" onClick={() => {
                wakeHuggingFaceSpace();
                setShowQuizGeneratorModal(true);
              }}>
                Generate Quiz
              </button>
              <button className="btn-action success" onClick={() => navigate('/auto-grading-results', { state: { section } })}>Auto-Grading Results</button>
            </div>

            <div className="action-card">
              <h4>Exams In Class</h4>
              <div className="exam-list">
                {exams && exams.length > 0 ? (
                  exams.map((exam, idx) => exam ? (
                    <div
                      key={exam.id || `exam-${idx}`}
                      className={`exam-card${selectedExamId === exam.id ? ' active' : ''}`}
                      onClick={() => {
                        setSelectedExamId(exam.id);
                        handleViewExam(exam);
                      }}
                    >
                      <div className="exam-icon">📄</div>
                      <div className="exam-info">
                        <h4>{exam.title || 'Untitled Exam'}</h4>
                        <p>{exam.created_at ? new Date(exam.created_at).toLocaleDateString() : 'No date'}</p>
                      </div>
                      <button
                        className="delete-exam-btn"
                        onClick={(e) => handleDeleteExam(e, exam.id)}
                        title="Delete Exam"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ) : null)
                ) : (
                  <p style={{ fontSize: '14px', color: '#666' }}>No exams posted yet.</p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* MODALS BELOW */}

      {/* Old Add-Student modal removed — replaced by inline search */}

      {showAttachModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content attach-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-bar">
              <span className="modal-prof-label">ScanMine Professor Console</span>
              <button className="modal-close-btn" onClick={closeModal}>×</button>
            </div>

            <div className="modal-title-banner">Attach Exam with Answer Key</div>

            <div className="upload-section">
              <label className="upload-label">Exam Title</label>
              <input
                type="text"
                className="create-input"
                placeholder="e.g. Algebra Midterm"
                value={examTitle}
                onChange={(e) => setExamTitle(e.target.value)}
              />
            </div>

            <div className="upload-section">
              <label className="upload-label">📄 Exam Questions File (Optional)</label>
              <div className="upload-row" onClick={() => examInputRef.current && examInputRef.current.click()}>
                <span className="upload-placeholder">
                  {examFile?.name ? examFile.name : 'Upload PDF / Word / Image'}
                </span>
                <input
                  type="file"
                  ref={examInputRef}
                  style={{ display: 'none' }}
                  onChange={handleExamFileChange}
                />
                <button className="browse-btn exam-browse">Browse</button>
              </div>
            </div>

            <div className="manual-section">
              <p className="manual-divider">Define Answer Key (Optional - Space or Comma separated)</p>
              <textarea
                className="manual-textarea"
                placeholder="e.g. A, B, C, Newton, 10.5..."
                value={manualAnswers}
                onChange={(e) => setManualAnswers(e.target.value)}
              />
            </div>

            <div className="modal-footer">
              <button
                className="save-assign-btn"
                onClick={handleSaveAndAssign}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save & Link Key'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showExamDetails && (
        <div className="modal-overlay" onClick={() => setShowExamDetails(null)}>
          <div className="modal-content details-modal exam-details-modal" onClick={e => e.stopPropagation()}>
            <div className="exam-details-header">
              <div className="exam-details-heading">
                <div>
                  <span className="exam-details-eyebrow">EXAM DETAILS</span>
                  <h2>{showExamDetails?.title || 'Untitled'}</h2>
                </div>
                <span className="exam-items-pill">
                  {(examQuestions?.manual?.length || 0) + (examQuestions?.generated?.length || 0)} items
                </span>
              </div>
              <div className="exam-details-actions">
                <button
                  className="exam-action-button exam-action-primary"
                  onClick={() => {
                    wakeHuggingFaceSpace();
                    navigate('/auto-grading-results', {
                      state: {
                        section,
                        examId: showExamDetails.id,
                        openScanModal: true,
                        role: user?.role,
                        studentName: user?.name || user?.fullName
                      }
                    });
                  }}
                  title="Scan student papers for this exam"
                >
                  <Camera size={16} />
                  Scan Papers
                </button>

                <button
                  className="exam-action-button"
                  onClick={handleExportExcel}
                  title="Export student scores to Excel"
                >
                  <Download size={16} />
                  Export to Excel
                </button>

                <button
                  className="exam-action-button"
                  onClick={() => {
                    wakeHuggingFaceSpace();
                    const currentAnswers = examQuestions?.manual?.map(a => cleanAnswer(a.correct_answer)).filter(Boolean).join(', ') || '';
                    setExamTitle(showExamDetails?.title || '');
                    setManualAnswers(currentAnswers);
                    setShowAttachModal(true);
                  }}
                  title="Edit or manually enter answer key"
                >
                  <Edit size={15} />
                  Edit Key
                </button>

                {showExamDetails?.file_path && (
                  <button
                    className="exam-icon-action"
                    onClick={() => window.open(showExamDetails.file_path, '_blank')}
                    title="View answer key document"
                  >
                    <Eye size={17} />
                  </button>
                )}
                <button className="exam-icon-action exam-close-action" onClick={() => setShowExamDetails(null)} aria-label="Close exam details">×</button>
              </div>
            </div>

            <div className="modal-body exam-details-grid">
              {/* Left Column: Answer Keys & OCR */}
              <div className="exam-details-left">
                <div className="details-section exam-detail-card">
                  <h4>Manual Answer Key ({examQuestions?.manual?.length || 0})</h4>
                  <div className="questions-list">
                    {examQuestions?.manual && examQuestions.manual.length > 0 ? (
                      examQuestions.manual.map((a, idx) => a ? (
                        <div key={a.id || `manual-${idx}`} className="question-item">
                          <p><strong>{idx + 1}. {a.question_text || `Question ${idx + 1}`}</strong></p>
                          <p className="ans-text" style={{ color: '#059669', fontWeight: 'bold' }}>
                            Answer: {a.type === 'multiple_choice' || (Array.isArray(a.options) && a.options.length > 0)
                              ? getMultipleChoiceDetails({ ...a, correctAnswer: a.correct_answer }).answer
                              : cleanAnswer(a.correct_answer) || 'N/A'}
                          </p>
                        </div>
                      ) : null)
                    ) : (
                      <p>No manual answers defined.</p>
                    )}
                  </div>
                </div>

                <div className="details-section exam-detail-card exam-ocr-card">
                  <h4 style={{ margin: '0 0 10px 0' }}>OCR Answer Key Extraction</h4>
                  <div className="upload-row" onClick={() => answerKeyInputRef.current && answerKeyInputRef.current.click()} style={{ marginBottom: '10px' }}>
                    <span className="upload-placeholder">
                      {answerKeyImage?.name ? answerKeyImage.name : 'Upload Official Answer Key PDF/Image'}
                    </span>
                    <input
                      type="file"
                      ref={answerKeyInputRef}
                      style={{ display: 'none' }}
                      accept=".jpg,.jpeg,.png,.pdf"
                      onChange={handleAnswerKeyImageChange}
                    />
                    <button className="browse-btn exam-browse">Browse</button>
                  </div>

                  <button
                    className="save-assign-btn"
                    onClick={() => handleProcessOCR(showExamDetails.id)}
                    disabled={isProcessingOCR || !answerKeyImage}
                    style={{ width: '100%', marginBottom: '10px' }}
                  >
                    {isProcessingOCR ? 'Scanning Document...' : 'Extract Answers via OCR'}
                  </button>

                  {parsedOCRData && parsedOCRData.length > 0 && (
                    <div style={{ marginTop: '15px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '15px' }}>
                      <h5 style={{ margin: '0 0 10px 0', color: '#334155' }}>Preview: {parsedOCRData.length} Answers Detected</h5>
                      <div style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '15px', padding: '10px', background: '#f1f5f9', borderRadius: '6px' }}>
                        {parsedOCRData.map((item, i) => item ? (
                          <div key={`parsed-${i}`} style={{ marginBottom: '8px', fontSize: '13px', display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#475569' }}>{item?.questionText ? item.questionText.substring(0, 30) : 'Question'}...</span>
                            <strong style={{ color: '#16a34a' }}>{cleanAnswer(item?.correctAnswer) || '?'}</strong>
                          </div>
                        ) : null)}
                      </div>

                      <button
                        onClick={handleSaveOCRToDatabase}
                        style={{
                          width: '100%',
                          padding: '10px 16px',
                          background: '#2563eb',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: '600',
                          boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)'
                        }}
                      >
                        Save to Database
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Student Progress */}
              <section className="exam-detail-card exam-progress-card">
                <div className="exam-card-heading">
                  <div>
                    <span className="exam-card-kicker">CLASS ACTIVITY</span>
                    <h3>Student progress</h3>
                  </div>
                  <span className="exam-graded-pill">
                    {students.filter(s => s.status === 'enrolled' && examSubmissions.some(sub => sub.student_id === s.user_id)).length} graded
                  </span>
                </div>

                <div className="exam-progress-section">
                  <h5 style={{ color: '#059669', marginBottom: '10px', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Graded ({students.filter(s => examSubmissions.some(sub => sub.student_id === s.user_id)).length})
                  </h5>
                  <div className="exam-progress-list">
                    {students
                      .filter(s => s.status === 'enrolled')
                      .map(s => {
                        const sub = examSubmissions.find(sub => sub.student_id === s.user_id);
                        if (!sub) return null;
                        return (
                          <div key={s.user_id} className="exam-progress-row">
                            <div className="exam-progress-identity">
                              <span className="exam-progress-name">{s.name}</span>
                              {sub.is_verified !== false ? (
                                <span className="exam-verified-badge">✔ Verified</span>
                              ) : (
                                <span className="exam-unverified-badge">Unverified</span>
                              )}
                            </div>
                            <span className="exam-score-pill">
                              {sub.points_earned ?? 0}/{sub.total_items ?? '?'}
                            </span>
                            <div className="exam-student-actions">
                              <button className="exam-row-action" onClick={() => handleViewStudent(s)} title={`View ${s.name}'s details`} aria-label={`View ${s.name}'s details`}>
                                <Eye size={15} />
                              </button>
                              <button
                                className="exam-row-action"
                                onClick={() => navigate('/auto-grading-results', { state: { section, examId: showExamDetails.id, studentId: s.user_id, openScanModal: true, role: user?.role, studentName: user?.name || user?.fullName } })}
                                title={`Re-scan ${s.name}'s paper`}
                                aria-label={`Re-scan ${s.name}'s paper`}
                              >
                                <Camera size={15} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>

                <div className="exam-progress-section exam-pending-section">
                  <h5 style={{ color: '#64748b', marginBottom: '10px', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Pending ({students.filter(s => s.status === 'enrolled' && !examSubmissions.some(sub => sub.student_id === s.user_id)).length})
                  </h5>
                  <div className="exam-progress-list exam-pending-list">
                    {students
                      .filter(s => s.status === 'enrolled' && !examSubmissions.some(sub => sub.student_id === s.user_id))
                      .map(s => (
                        <div key={s.user_id} className="exam-progress-row is-pending">
                          <div className="exam-progress-identity">
                            <span className="exam-progress-name">{s.name}</span>
                            <span className="exam-pending-label">Not submitted</span>
                          </div>
                          <button
                            className="exam-row-action"
                            onClick={() => navigate('/auto-grading-results', { state: { section, examId: showExamDetails.id, studentId: s.user_id, openScanModal: true, role: user?.role, studentName: user?.name || user?.fullName } })}
                            title={`Scan ${s.name}'s paper`}
                            aria-label={`Scan ${s.name}'s paper`}
                          >
                            <Camera size={15} />
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {selectedStudent && (
        <div className="modal-overlay" onClick={() => setSelectedStudent(null)} style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="modal-content" style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            padding: '32px',
            width: '100%',
            maxWidth: '600px',
            position: 'relative',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.15)',
            pointerEvents: 'auto',
            maxHeight: '85vh',
            overflowY: 'auto'
          }} onClick={e => e.stopPropagation()}>

            <button
              className="modal-close-btn"
              onClick={() => setSelectedStudent(null)}
              style={{
                position: 'absolute',
                top: '20px',
                right: '20px',
                background: 'none',
                border: 'none',
                fontSize: '24px',
                color: '#94a3b8',
                cursor: 'pointer',
                lineHeight: 1
              }}
            >
              ×
            </button>

            <header style={{ marginBottom: '28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingRight: '30px' }}>
                <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a', fontWeight: '800' }}>
                  Student Details: {selectedStudent.name}
                </h2>
                {!isEditingStudentName && (
                  <button
                    type="button"
                    onClick={() => {
                      setStudentNameDraft(selectedStudent.name || '');
                      setStudentNameError('');
                      setIsEditingStudentName(true);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '7px 10px',
                      color: '#475569',
                      background: '#f1f5f9',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <Pencil size={14} />
                    Edit Name
                  </button>
                )}
              </div>
              {isEditingStudentName && (
                <form onSubmit={handleSaveStudentName} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                  <input
                    type="text"
                    aria-label="Student full name"
                    value={studentNameDraft}
                    onChange={(event) => setStudentNameDraft(event.target.value)}
                    disabled={studentNameSaving}
                    autoFocus
                    style={{ flex: '1 1 220px', minWidth: 0, padding: '9px 11px', border: '1px solid #cbd5e1', borderRadius: '8px', font: 'inherit' }}
                  />
                  <button
                    type="submit"
                    disabled={studentNameSaving}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '8px 11px', color: '#fff', background: '#2563eb', border: 0, borderRadius: '8px', fontWeight: '600', cursor: studentNameSaving ? 'wait' : 'pointer' }}
                  >
                    <Check size={15} />
                    {studentNameSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    disabled={studentNameSaving}
                    onClick={() => {
                      setStudentNameDraft(selectedStudent.name || '');
                      setStudentNameError('');
                      setIsEditingStudentName(false);
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '8px 11px', color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', fontWeight: '600', cursor: studentNameSaving ? 'wait' : 'pointer' }}
                  >
                    <X size={15} />
                    Cancel
                  </button>
                </form>
              )}
              {studentNameError && (
                <p role="alert" style={{ margin: '8px 0 0', color: '#b91c1c', fontSize: '0.85rem' }}>{studentNameError}</p>
              )}
              <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '0.95rem' }}>{selectedStudent.email}</p>
            </header>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
              {/* Completed Section */}
              <div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Completed Assessments ({studentSubmissions.length})
                </h4>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
                  {studentSubmissions.length > 0 ? (
                    studentSubmissions.map((sub, idx) => (
                      <div key={sub.id} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '16px',
                        backgroundColor: '#ffffff',
                        borderBottom: idx === studentSubmissions.length - 1 ? 'none' : '1px solid #e2e8f0'
                      }}>
                        <span style={{ fontWeight: '600', color: '#1e293b', fontSize: '0.95rem' }}>{sub.exam_title}</span>
                        <span style={{
                          backgroundColor: '#dcfce7',
                          color: '#166534',
                          padding: '4px 12px',
                          borderRadius: '9999px',
                          fontSize: '13px',
                          fontWeight: '700'
                        }}>
                          {sub.points_earned ?? sub.score ?? 0} / {sub.total_items ?? sub.total_questions ?? '?'}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', fontSize: '14px' }}>
                      No completed assessments found.
                    </div>
                  )}
                </div>
              </div>

              {/* Pending Section */}
              <div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Pending Assessments ({exams.filter(e => !studentSubmissions.some(sub => sub.exam_title === e.title)).length})
                </h4>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
                  {exams
                    .filter(e => !studentSubmissions.some(sub => sub.exam_title === e.title))
                    .map((e, idx, arr) => (
                      <div key={e.id} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '16px',
                        backgroundColor: '#ffffff',
                        borderBottom: idx === arr.length - 1 ? 'none' : '1px solid #e2e8f0'
                      }}>
                        <span style={{ color: '#475569', fontSize: '0.95rem', fontWeight: '500' }}>{e.title}</span>
                        <span style={{
                          backgroundColor: '#f1f5f9',
                          color: '#475569',
                          padding: '4px 12px',
                          borderRadius: '9999px',
                          fontSize: '11px',
                          fontWeight: '700',
                          textTransform: 'uppercase'
                        }}>
                          Pending
                        </span>
                      </div>
                    ))}
                  {exams.filter(e => !studentSubmissions.some(sub => sub.exam_title === e.title)).length === 0 && (
                    <div style={{ padding: '24px', textAlign: 'center', color: '#16a34a', fontSize: '14px', fontWeight: '500', backgroundColor: '#f0fdf4' }}>
                      ✨ All assigned assessments are complete.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showQuizGeneratorModal && (
        <div className="ai-quiz-modal-overlay" onClick={closeQuizGeneratorModal}>
          <div className="ai-quiz-modal" role="dialog" aria-modal="true" aria-labelledby="quiz-generator-title" onClick={(e) => e.stopPropagation()}>
            <header className="ai-quiz-modal-header">
              <div>
                <span className="ai-quiz-eyebrow">QUIZ GENERATION</span>
                <h2 id="quiz-generator-title">Generate AI Quiz</h2>
                <p>Create quiz questions automatically from a lesson PDF</p>
              </div>
              <button
                className="ai-quiz-close"
                type="button"
                aria-label="Close quiz generator"
                onClick={closeQuizGeneratorModal}
                disabled={isGeneratingQuiz || isSavingQuiz}
              >
                <X size={20} />
              </button>
            </header>

            <div className="ai-quiz-modal-body">
              <div className="ai-quiz-field">
                <label className="ai-quiz-label" htmlFor="quiz-exam-title">Exam Title</label>
                <input
                  id="quiz-exam-title"
                  type="text"
                  className="ai-quiz-input"
                  placeholder="e.g. Science Chapter 5 Quiz"
                  value={examTitle}
                  onChange={(e) => setExamTitle(e.target.value)}
                />
              </div>

              <div className="ai-quiz-field">
                <label className="ai-quiz-label" htmlFor="quiz-lesson-file">Lesson PDF</label>
                <label className="ai-quiz-dropzone">
                  <input
                    id="quiz-lesson-file"
                    type="file"
                    ref={quizFileRef}
                    className="ai-quiz-file-input"
                    accept=".pdf"
                    onChange={handleQuizFileChange}
                  />
                  <Upload size={21} aria-hidden="true" />
                  <span className="ai-quiz-file-name">
                    {quizLessonFile?.name || 'Choose a lesson PDF to upload'}
                  </span>
                  <span className="ai-quiz-file-hint">PDF files only</span>
                  <span className="ai-quiz-browse">Browse</span>
                </label>
              </div>

              <div className="ai-quiz-field">
                <label className="ai-quiz-label" htmlFor="quiz-question-count">Number of Questions</label>
                <input
                  id="quiz-question-count"
                  type="number"
                  className="ai-quiz-input"
                  placeholder="10"
                  value={numberOfQuestions}
                  onChange={(e) => setNumberOfQuestions(parseInt(e.target.value) || 10)}
                  min="1"
                  max="50"
                />
              </div>

              <div className="ai-quiz-field">
                <span className="ai-quiz-label">Question Types</span>
                <div className="ai-quiz-type-pills">
                  {[
                    { key: 'multiple_choice', label: 'Multiple Choice' },
                    { key: 'true_false', label: 'True / False' },
                    { key: 'identification', label: 'Identification' },
                  ].map(({ key, label }) => {
                    const active = questionTypes.includes(key);
                    return (
                      <button
                        key={key}
                        className={`ai-quiz-type-pill${active ? ' is-selected' : ''}`}
                        onClick={() => toggleQuestionType(key)}
                        type="button"
                        aria-pressed={active}
                      >
                        {active && <Check size={15} aria-hidden="true" />}
                        {label}
                      </button>
                    );
                  })}
                </div>
                {questionTypes.length === 0 && (
                  <p className="ai-quiz-warning">Select at least one question type.</p>
                )}
              </div>

              <div className="ai-quiz-field">
                <label className="ai-quiz-label" htmlFor="quiz-custom-instructions">
                  Custom AI Instructions <span>(optional)</span>
                </label>
                <textarea
                  id="quiz-custom-instructions"
                  className="ai-quiz-input ai-quiz-textarea"
                  placeholder="e.g. Focus on Chapter 3 definitions. Avoid timeline questions. Make items tricky."
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  rows={3}
                />
                <p className="ai-quiz-help">These instructions are passed directly to the AI for extra control.</p>
              </div>

              {quizError && (
                <p className="ai-quiz-error" role="alert">{quizError}</p>
              )}

              {generatedQuestions.length > 0 && (
                <div className="ai-quiz-preview">
                  <h4 className="quiz-preview-title">📋 Generated Questions Preview ({generatedQuestions.length})</h4>
                  <div className="quiz-preview-list">
                    {generatedQuestions.map((q, index) => (
                      <div key={index} className="quiz-preview-item">
                        <span className="quiz-preview-type">{q.type?.replace('_', ' ')}</span>
                        <p className="quiz-preview-q">{index + 1}. {q.question || q.question_text}</p>
                        <p className="quiz-preview-ans">✓ {q.type === 'multiple_choice'
                          ? getMultipleChoiceDetails(q).answer
                          : q.correctAnswer || q.answer_text}</p>
                        {q.options?.length > 0 && (
                          <div className="quiz-preview-opts">
                            {getMultipleChoiceDetails(q).options.map((opt, i) => (
                              <span key={i} className={`quiz-opt-chip${q.type === 'multiple_choice' && i === getMultipleChoiceDetails(q).optionIndex ? ' quiz-opt-correct' : ''}`}>
                                {opt}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="quiz-preview-actions">
                    <button
                      className="save-assign-btn"
                      onClick={handleSaveAndAssignQuiz}
                      disabled={isSavingQuiz || isGeneratingQuiz}
                    >
                      {isSavingQuiz ? (
                        <span className="quiz-btn-loading">
                          <span className="quiz-gen-spinner" aria-hidden="true" />
                          Saving...
                        </span>
                      ) : 'Save & Assign to Class'}
                    </button>
                    <button
                      className="save-assign-btn quiz-download-btn"
                      onClick={handleDownloadAnswerKey}
                      disabled={isSavingQuiz || isGeneratingQuiz}
                      style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
                    >
                      📥 Download ScanMine Answer Key
                    </button>
                  </div>
                </div>
              )}
            </div>

            <footer className="ai-quiz-modal-footer">
              <button
                className="ai-quiz-cancel"
                type="button"
                onClick={closeQuizGeneratorModal}
                disabled={isGeneratingQuiz || isSavingQuiz}
              >
                Cancel
              </button>
              <button
                className="ai-quiz-generate"
                type="button"
                onClick={handleGenerateQuiz}
                disabled={isGeneratingQuiz || isSavingQuiz || questionTypes.length === 0}
              >
                {isGeneratingQuiz ? (
                  <span className="quiz-btn-loading">
                    <span className="quiz-gen-spinner" aria-hidden="true" />
                    Generating...
                  </span>
                ) : 'Generate Quiz'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default SectionDetails;