import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom"
import "../App.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "./useTheme";
import html2pdf from "html2pdf.js";



/* =========================
   📊 RISK DASHBOARD COMPONENT
========================= */
const RiskDashboard = ({ riskyCount, safeCount, importantCount }) => {
  const total = riskyCount + safeCount;
  // Calculate score: 100% is safe, 0% is high risk
  const score = total === 0 ? 100 : Math.round((safeCount / (riskyCount + safeCount)) * 100);
  
  let status = "High Risk";
  let color = "#ff6b6b"; // Red
  if (score > 75) { status = "Safe"; color = "#1dd1a1"; } // Green
  else if (score > 40) { status = "Moderate"; color = "#feca57"; } // Yellow

  return (
    <div className="risk-dashboard">
      <div className="risk-score-circle" style={{ borderColor: color }}>
        <span className="score-value" style={{ color: color }}>{score}%</span>
        <span className="score-label">Safety</span>
      </div>
      
      <div className="risk-stats">
        <div className="stat-item">
          <span className="stat-dot risky"></span>
          <span>{riskyCount} Risky Clauses</span>
        </div>
        <div className="stat-item">
          <span className="stat-dot safe"></span>
          <span>{safeCount} Safe Clauses</span>
        </div>
        <div className="stat-item">
          <span className="stat-dot important"></span>
          <span>{importantCount} Key Terms</span>
        </div>
      </div>
      
      <div className="risk-badge" style={{ backgroundColor: color }}>
        {status}
      </div>
    </div>
  );
};

/* =========================
   🎨 COLOR PARSER COMPONENT
========================= */
const LegalResponseRenderer = ({ content }) => {
  if (!content) return null;

  const sections = content.split(/## (Case Summary|Explanation|Risky clauses|Important terms|Safe clauses)/g);
  if (sections.length < 2) {
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
  }

  const renderedBlocks = [];
  // Initialize counts for the dashboard
  let counts = { risky: 0, safe: 0, important: 0 };

  for (let i = 1; i < sections.length; i += 2) {
    const title = sections[i];
    const text = sections[i + 1];

    // Logic: Count Markdown bullet points (* or -) in each section
    const bulletCount = (text.match(/^\s*[*|-]\s/gm) || []).length;
    if (title === "Risky clauses") counts.risky = bulletCount;
    if (title === "Safe clauses") counts.safe = bulletCount;
    if (title === "Important terms") counts.important = bulletCount;

    let cssClass = "legal-section-explanation";
    if (title === "Case Summary") cssClass = "legal-section-summary";
    if (title === "Risky clauses") cssClass = "legal-section-risky";
    if (title === "Important terms") cssClass = "legal-section-important";
    if (title === "Safe clauses") cssClass = "legal-section-safe";

    renderedBlocks.push(
      <div key={i} className={cssClass}>
        {title !== "Case Summary" && <div className="legal-header">{title}</div>}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="legal-response-container">
      {/* 🚀 New Dashboard Section */}
      {(counts.risky > 0 || counts.safe > 0) && (
        <RiskDashboard 
          riskyCount={counts.risky} 
          safeCount={counts.safe} 
          importantCount={counts.important} 
        />
      )}
      {renderedBlocks}
    </div>
  );
};

export default function App() {
  const { isLightMode, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [loading, setLoading] = useState(false);

  const [mode, setMode] = useState("⚖️ Legal professional");
  const [isModeOpen, setIsModeOpen] = useState(false);
  const modeRef = useRef(null);

  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);

  const [sidebarOpen, setSidebarOpen] = useState(true); 
  const [showUserMenu, setShowUserMenu] = useState(false);

  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const userName = localStorage.getItem("userName") || "User";
  const userRole = localStorage.getItem("role"); 

  /* =========================
     🔐 LOGIN PROTECTION
  ========================= */
  useEffect(() => {
    const token = localStorage.getItem("token");

    if (!token) {
      window.location.href = "/login";
      return;
    }

    fetchSessions();
  }, []);

  /* =========================
     🖱️ CLOSE DROPDOWN ON OUTSIDE CLICK
  ========================= */
  useEffect(() => {
    function handleClickOutside(event) {
      if (modeRef.current && !modeRef.current.contains(event.target)) {
        setIsModeOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  /* =========================
     🔹 TYPEWRITER EFFECT
  ========================= */
  const typeEffect = (text, callback) => {
    let i = 0;
    let current = "";

    const interval = setInterval(() => {
      current += text.charAt(i);
      callback(current);
      i++;
      if (i >= text.length) clearInterval(interval);
    }, 5);
  };

  /* =========================
     📄 DOWNLOAD PDF FUNCTION (ADD THIS HERE)
  ========================= */
  const downloadPDF = (index, title = "Legal_Consultation") => {
    const element = document.getElementById(`ai-message-${index}`);
    
    const opt = {
      margin:       10,
      filename:     `${title.replace(/\s+/g, "_")}.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, logging: false },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).save();
  };

  /* ========================= */
  const fetchSessions = async () => {
    try {
      const token = localStorage.getItem("token");

      const res = await fetch("http://localhost:5000/api/sessions", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (Array.isArray(data)) setSessions(data);
    } catch (err) {
      console.error("Failed to load sessions:", err);
    }
  };

  const loadSession = async (sessionId) => {
    setCurrentSessionId(sessionId);
    setLoading(true);

    try {
      const token = localStorage.getItem("token");

      const res = await fetch(
        `http://localhost:5000/api/sessions/${sessionId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const data = await res.json();

      const uiMessages = [];
      data.forEach((chat) => {
        uiMessages.push({ role: "user", content: chat.question });
        uiMessages.push({ role: "ai", content: chat.answer });
      });

      setMessages(uiMessages);
      setSidebarOpen(false); 
    } catch (err) {
      console.error("Error loading session:", err);
    } finally {
      setLoading(false);
    }
  };

  const deleteSession = async (e, sessionId) => {
    e.stopPropagation(); 
    if (!window.confirm("Delete this chat history permanently?")) return;

    try {
      const token = localStorage.getItem("token");
      
      const res = await fetch(`http://localhost:5000/api/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setSessions((prev) => prev.filter(s => s.sessionId !== sessionId));

        if (currentSessionId === sessionId) {
          setCurrentSessionId(null);
          setMessages([]);
        }
      }
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  const startNewChat = async () => {
    setLoading(true);

    try {
      const token = localStorage.getItem("token");

      const res = await fetch("http://localhost:5000/api/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();

      if (data.sessionId) {
        setCurrentSessionId(data.sessionId);
        setMessages([]);
        setInput("");
        setImage(null);
        setPreview(null);
        await fetchSessions();
        setSidebarOpen(false); 
        return data.sessionId;
      }
    } catch (err) {
      console.error("Session creation error:", err);
    } finally {
      setLoading(false);
    }
  };

  const askAI = async () => {
    if ((!input.trim() && files.length === 0) || loading) return;

    let activeSessionId = currentSessionId;
    if (!activeSessionId) {
      activeSessionId = await startNewChat();
      if (!activeSessionId) return;
    }

    const token = localStorage.getItem("token");

    // Add files to UI immediately
    if (files.length > 0) {
      setMessages((prev) => [...prev, { role: "user", files: previews }]);
    }

    if (input.trim())
      setMessages((prev) => [...prev, { role: "user", content: input }]);

    setLoading(true);
    const userText = input;
    
    setInput("");
    setFiles([]);   
    setPreviews([]); 

    try {
      const formData = new FormData();
      formData.append("question", userText || "Explain these files legally");
      formData.append("sessionId", activeSessionId);
      formData.append("mode", mode);

      files.forEach((file) => {
        formData.append("files", file); // Must match backend 'upload.array("files")'
      });

      const res = await fetch("http://localhost:5000/api/ask", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();

      if (!data.answer) throw new Error("Empty response");

      let aiMessage = { role: "ai", content: "" };
      setMessages((prev) => [...prev, aiMessage]);

      typeEffect(data.answer, (text) => {
        aiMessage.content = text;
        setMessages((prev) => [...prev.slice(0, -1), aiMessage]);
      });

      fetchSessions();
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: "ai", content: "❌ Error contacting server." },
      ]);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length === 0) return;

    setFiles((prev) => [...prev, ...selectedFiles]);

    const newPreviews = selectedFiles.map((file) => {
      if (file.type.startsWith("image/")) {
        return { type: "image", url: URL.createObjectURL(file) };
      }
      return { type: "doc", name: file.name };
    });
    
    setPreviews((prev) => [...prev, ...newPreviews]);
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="dashboard-container">

      {/* ✅ SIDEBAR */}
      <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>

      <div className="sidebar-header">
        <span>Legal AI</span>
      </div>

        <button className="new-chat-btn" onClick={startNewChat}>
          + New Consultation
        </button>

        <div className="history-list">
          {sessions.length === 0 && <p>No history found</p>}

          {sessions.map((session) => (
            <div
              key={session.sessionId}
              className={`history-item ${
                currentSessionId === session.sessionId ? "active" : ""
              }`}
              onClick={() => loadSession(session.sessionId)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }} // Inline style for layout
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "85%" }}>
                {session.title?.substring(0, 25) || "Consultation"}
              </span>

              <button
                onClick={(e) => deleteSession(e, session.sessionId)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#ff6b6b",
                  cursor: "pointer",
                  fontSize: "16px",
                  padding: "0 5px",
                  marginLeft: "5px"
                }}
                title="Delete Chat"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div
          className="user-profile clickable"
          onClick={() => setShowUserMenu(!showUserMenu)}
        >
          <div className="avatar">
            {userName.charAt(0).toUpperCase()}
          </div>

          <div className="user-info">
            <div className="user-name">{userName}</div>
          </div>
        </div>

        {showUserMenu && (
          <div className="user-dashboard-menu">

            {/* ☀️ THEME TOGGLE BUTTON */}
            <div className="menu-item" onClick={toggleTheme}>
              {isLightMode ? "🌙 Dark Mode" : "☀️ Light Mode"}
            </div>
            
            {/* 👑 SHOW ADMIN BUTTON ONLY IF ROLE IS ADMIN */}
            {userRole === "admin" && (
              <div 
                className="menu-item" 
                onClick={() => navigate("/admin")}
                style={{ color: "#a8c7fa", fontWeight: "bold", borderBottom: "1px solid #444" }} 
              >
                Admin Dashboard
              </div>
            )}
            
            <div
              className="menu-item logout"
              onClick={() => {
                localStorage.clear();
                navigate("/"); 
              }}
            >
              Logout
            </div>
          </div>
        )}
      </aside>

      {/* ✅ MAIN AREA */}
      <main className="app">

        {/* TOGGLE BUTTON */}
        <button
          className="menu-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          ☰
        </button>

        <div className="page-title">
          <img 
            src="/balance.png" 
            /*alt="Justice Scale Watermark"*/
            className="title-watermark" 
          />
          AI Legal Assistant INDIA
        </div>

        <div className="chat">
          {messages.map((msg, i) => (
            <div 
              key={i} 
              id={msg.role === "ai" ? `ai-message-${i}` : undefined} /* 👈 ADD THIS ID */
              className={`bubble ${msg.role}`}
            >
             {/* Handle Array of Mixed Files */}
              {msg.files && msg.files.length > 0 && (
                <div className={`image-grid ${msg.files.length === 1 ? "single-image" : ""}`}>
                  {msg.files.map((file, idx) => (
                    file.type === "image" ? (
                      <img key={idx} src={file.url} alt="uploaded" className="chat-image" onClick={() => window.open(file.url, "_blank")} />
                    ) : (
                      <div key={idx} className="chat-doc-bubble">📄 {file.name}</div>
                    )
                  ))}
                </div>
              )} 

            {msg.content && (
              msg.role === "ai" ? (
                <LegalResponseRenderer content={msg.content} />
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content}
                </ReactMarkdown>
              )
            )}  

            {/* 👈 ADD THIS NEW BUTTON BLOCK */}
            {msg.role === "ai" && msg.content && (
              <button 
                className="download-pdf-btn" 
                data-html2canvas-ignore="true" 
                onClick={() => downloadPDF(i, "AI_Legal_Analysis")}
              >
                📄 Download as PDF
              </button>
            )}
            {/* END OF NEW BUTTON BLOCK 👉 */}

            </div>
          ))}

          {loading && (
            <div className="bubble ai">
              <span className="typing-dot">Analyzing...</span>
            </div>
          )}
        </div>
        <div className="input-container">
          <span
            className="attach-icon"
            onClick={() => fileInputRef.current.click()}
          >
            +
          </span>

          <textarea
            ref={textareaRef}
            placeholder="Ask anything..."
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                askAI();
              }
            }}
            disabled={loading}
          />

          {/* DROPDOWN BLOCK */}
          <div className="custom-mode-container" ref={modeRef}>
            <div 
              className="custom-mode-button" 
              onClick={() => setIsModeOpen(!isModeOpen)}
              style={{ opacity: loading ? 0.5 : 1, pointerEvents: loading ? 'none' : 'auto' }}
            >
              <span className="mode-text">{mode}</span>
              <span className={`chevron ${isModeOpen ? "open" : ""}`}>▼</span>
            </div>

            {isModeOpen && (
              <div className="custom-mode-menu">
                {["🧑 Simple explanation", "⚖️ Legal professional", "🎯 Action-focused"].map((option) => (
                  <div 
                    key={option}
                    className={`custom-mode-item ${mode === option ? "active" : ""}`}
                    onClick={() => {
                      setMode(option);
                      setIsModeOpen(false);
                    }}
                  >
                    {option}
                  </div>
                ))}
              </div>
            )}
          </div>

          <button className="send-btn" onClick={askAI} disabled={loading}>
            ➤
          </button>

            {previews.length > 0 && (
              <div className="image-preview-container">
                {previews.map((file, idx) => (
                  <div key={idx} className="preview-item">
                    {file.type === "image" ? (
                      <img src={file.url} alt="preview" />
                    ) : (
                      <div className="preview-doc">📄 {file.name}</div>
                    )}
                    <button className="remove-btn" onClick={() => removeFile(idx)}>×</button>
                  </div>
                ))}
              </div>
            )}
          <input
            type="file"
            accept="image/*, application/pdf, text/plain, application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            ref={fileInputRef}
            hidden
            onChange={handleFileSelect}
          />
        </div>
      </main>
    </div>
  );
}