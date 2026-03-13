import { useState, useEffect, useRef } from "react";
import * as mammoth from "mammoth";

// ─── Parsing Logic ────────────────────────────────────────────────────────────
function parseQuestions(text) {
  const questions = [];
  const blocks = text.split(/\n(?=\s*[\[(（]?\d+[.、）\]]\s*\S)/);

  for (const block of blocks) {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const stemLine = lines[0].replace(/^[\[(（]?\d+[.、）\]]\s*/, "").trim();
    if (!stemLine) continue;

    const options = [];
    let answer = null;
    let explanation = "";
    let stemParts = [stemLine];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      // ① 答案行优先检测（必须放在选项检测之前！）
      // 支持格式：答案: B  答案：B  答案B  正确答案:ABDE  答案：A、B、D、E  答案：A B D E
      if (/^(【?答案】?|answer|参考答案|正确答案)[：:\s]*/i.test(line)) {
        const rest = line.replace(/^(【?答案】?|answer|参考答案|正确答案)[：:\s]*/i, "").trim();
        // 提取所有 A-E 字母（忽略中间的顿号、逗号、空格等分隔符）
        const letters = rest.match(/[A-Ea-e]/g);
        if (letters && letters.length > 0) {
          answer = [...new Set(letters.map(l => l.toUpperCase()))].sort().join("");
          // 检测答案后面是否跟着解析
          const afterAns = rest.replace(/[A-Ea-e、，, ]/g, "").replace(/^(解析|解题|分析)?[：:\s]*/i, "").trim();
          if (afterAns) explanation = afterAns;
        }
        continue;
      }

      // ② 解析行
      if (/^(【?解析】?|解题|分析)[：:\s]/i.test(line)) {
        explanation = line.replace(/^(【?解析】?|解题|分析)[：:\s]*/i, "").trim();
        continue;
      }

      // ③ 选项行：A. A、 (A) [A] A)
      if (/^[\[(（]?[A-Ea-e][.、）\]]\s*\S/.test(line)) {
        options.push({
          label: line[0].toUpperCase(),
          text: line.replace(/^[\[(（]?[A-Ea-e][.、）\]]\s*/, "").trim(),
        });
        continue;
      }

      // ④ 其余：题干续行 or 解析续行
      if (options.length === 0 && !answer) {
        stemParts.push(line);
      } else {
        explanation += (explanation ? " " : "") + line;
      }
    }

    const stem = stemParts.join(" ");
    if (stem.length < 3) continue;

    const isTF = options.length === 0 && /(对|错|是|否|正确|错误|true|false)/i.test(block);
    const isFill = options.length === 0 && !isTF;

    questions.push({
      id: questions.length,
      stem,
      options: isTF
        ? [{ label: "A", text: "正确 ✓" }, { label: "B", text: "错误 ✗" }]
        : options,
      answer: answer || null,
      explanation,
      type: isTF ? "tf" : isFill ? "fill" : "choice",
    });
  }

  return questions.filter(q => q.stem.length > 2);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const COLORS = {
  bg: "#0f0e17", surface: "#1a1927", card: "#221f35", border: "#2e2b45",
  accent: "#f4a261", accentSoft: "rgba(244,162,97,0.15)", accentGlow: "rgba(244,162,97,0.35)",
  correct: "#52d68a", wrong: "#ff6b6b", neutral: "#a09cc0",
  text: "#e8e6f0", textDim: "#7c7a9a",
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:wght@400;500;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${COLORS.bg}; color: ${COLORS.text}; font-family: 'DM Sans', sans-serif; }
  ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: ${COLORS.surface}; }
  ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 3px; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 ${COLORS.accentGlow}; } 50% { box-shadow: 0 0 0 10px transparent; } }
  .fade-up { animation: fadeUp 0.35s ease both; }
  .btn { cursor:pointer; border:none; outline:none; font-family:'DM Sans',sans-serif; font-weight:600; transition: all 0.18s ease; }
  .btn:active { transform: scale(0.96); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none !important; }
`;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? `${parseInt(r[1],16)},${parseInt(r[2],16)},${parseInt(r[3],16)}` : "255,255,255";
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("home");
  const [questions, setQuestions] = useState([]);
  const [session, setSession] = useState(null);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [flagged, setFlagged] = useState(new Set());
  const [showResult, setShowResult] = useState(false);
  const [mode, setMode] = useState("practice");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef();

  const normalize = s => s ? s.split("").sort().join("") : "";
  const isAnswerCorrect = (q, ans) => q.answer
    ? (q.answer.length > 1 ? normalize(ans) === normalize(q.answer) : ans === q.answer)
    : false;

  const wrongs = questions.filter((q, i) => answers[i] !== undefined && !isAnswerCorrect(q, answers[i]) && q.answer);
  const answered = Object.keys(answers).length;
  const correctCount = session
    ? session.indices.filter(i => isAnswerCorrect(questions[i], answers[i]) && questions[i]?.answer).length
    : 0;

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true); setError("");
    try {
      const buf = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buf });
      const parsed = parseQuestions(result.value);
      if (parsed.length === 0) throw new Error("未识别到题目，请检查文档格式（参考说明）");
      setQuestions(parsed);
      setAnswers({});
      setFlagged(new Set());
    } catch (e) {
      setError(e.message || "文件解析失败");
    }
    setLoading(false);
  };

  const startSession = (indices, sessionMode) => {
    setSession({ indices, mode: sessionMode });
    setCurrent(0);
    setShowResult(false);
    setScreen("quiz");
  };

  const submitAnswer = (idx, ans) => {
    setAnswers(prev => ({ ...prev, [idx]: ans }));
  };

  const toggleFlag = (idx) => {
    setFlagged(prev => {
      const s = new Set(prev);
      s.has(idx) ? s.delete(idx) : s.add(idx);
      return s;
    });
  };

  const q = session ? questions[session.indices[current]] : null;
  const qIdx = session ? session.indices[current] : null;
  const isPractice = session?.mode === "practice";
  const isLast = session ? current === session.indices.length - 1 : false;
  const progress = session ? (current + 1) / session.indices.length : 0;

  // ── Home ─────────────────────────────────────────────────────────────────────
  if (screen === "home") return (
    <div style={{ minHeight: "100vh", background: COLORS.bg }}>
      <style>{css}</style>
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: "18px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: COLORS.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📚</div>
          <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, fontWeight: 700, color: COLORS.text }}>题海漫游</span>
        </div>
        {questions.length > 0 && (
          <span style={{ color: COLORS.neutral, fontSize: 13 }}>已载入 <b style={{ color: COLORS.accent }}>{questions.length}</b> 道题</span>
        )}
      </div>

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "40px 24px" }}>
        {/* Import Card */}
        <div className="fade-up" style={{ background: COLORS.card, border: `2px dashed ${COLORS.border}`, borderRadius: 18, padding: "40px 32px", textAlign: "center", marginBottom: 32, cursor: "pointer", transition: "border-color 0.2s, background 0.2s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = COLORS.accent; e.currentTarget.style.background = COLORS.accentSoft; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.background = COLORS.card; }}
          onClick={() => fileRef.current.click()}>
          <input ref={fileRef} type="file" accept=".docx" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
          <div style={{ fontSize: 48, marginBottom: 12 }}>{loading ? "⏳" : "📄"}</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.text, marginBottom: 6 }}>
            {loading ? "解析中..." : "导入 Word 题库"}
          </div>
          <div style={{ fontSize: 13, color: COLORS.textDim }}>点击上传 .docx 文件 · 支持单选、多选、判断题</div>
          {error && <div style={{ marginTop: 12, color: COLORS.wrong, fontSize: 13 }}>⚠ {error}</div>}
        </div>

        {/* Format guide */}
        <details style={{ background: COLORS.surface, borderRadius: 12, padding: "14px 20px", marginBottom: 28, cursor: "pointer" }}>
          <summary style={{ color: COLORS.neutral, fontSize: 13, fontWeight: 600, userSelect: "none" }}>📋 题库格式说明（点击展开）</summary>
          <pre style={{ marginTop: 14, fontSize: 12, color: COLORS.textDim, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{`1. 以下哪个是Python的关键字？
A. define
B. def
C. function
D. method
答案: B
解析: def 是 Python 中定义函数的关键字

2. 判断题：Java是面向对象语言
答案: A
（正确选A，错误选B）`}</pre>
        </details>

        {/* Mode & Start */}
        {questions.length > 0 && (
          <div className="fade-up" style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "flex", gap: 12, marginBottom: 4 }}>
              {["practice", "exam"].map(m => (
                <button key={m} className="btn" onClick={() => setMode(m)}
                  style={{ flex: 1, padding: "12px 0", borderRadius: 10, fontSize: 14, background: mode === m ? COLORS.accent : COLORS.surface, color: mode === m ? "#0f0e17" : COLORS.neutral, border: `1px solid ${mode === m ? COLORS.accent : COLORS.border}` }}>
                  {m === "practice" ? "🎓 练习模式（即时反馈）" : "📝 考试模式（完成后评分）"}
                </button>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <ModeCard icon="🔀" title="顺序刷题" desc={`全部 ${questions.length} 题`} color={COLORS.accent}
                onClick={() => startSession(questions.map((_, i) => i), mode)} />
              <ModeCard icon="🎲" title="随机刷题" desc="乱序出题" color="#7c6fcd"
                onClick={() => startSession(shuffle(questions.map((_, i) => i)), mode)} />
              {wrongs.length > 0 && (
                <ModeCard icon="❌" title="错题本" desc={`${wrongs.length} 道错题`} color={COLORS.wrong}
                  onClick={() => startSession(wrongs.map(q => q.id), mode)} />
              )}
              {flagged.size > 0 && (
                <ModeCard icon="⭐" title="收藏题目" desc={`${flagged.size} 道`} color="#f7c59f"
                  onClick={() => startSession([...flagged], mode)} />
              )}
            </div>

            {/* Stats bar */}
            <div style={{ background: COLORS.surface, borderRadius: 12, padding: "16px 20px", display: "flex", gap: 28, justifyContent: "center" }}>
              {[
                { label: "总题数", val: questions.length, color: COLORS.text },
                { label: "已答", val: answered, color: COLORS.accent },
                { label: "正确", val: questions.filter((q, i) => isAnswerCorrect(q, answers[i])).length, color: COLORS.correct },
                { label: "错误", val: wrongs.length, color: COLORS.wrong },
                { label: "收藏", val: flagged.size, color: "#f7c59f" },
              ].map(s => (
                <div key={s.label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ── Result ────────────────────────────────────────────────────────────────────
  if (screen === "quiz" && showResult) {
    const total = session.indices.length;
    const withAns = session.indices.filter(i => questions[i]?.answer).length;
    const score = withAns > 0 ? Math.round(correctCount / withAns * 100) : null;
    return (
      <div style={{ minHeight: "100vh", background: COLORS.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <style>{css}</style>
        <div className="fade-up" style={{ background: COLORS.card, borderRadius: 20, padding: "48px 40px", maxWidth: 480, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 64 }}>{score === null ? "📋" : score >= 80 ? "🎉" : score >= 60 ? "💪" : "📖"}</div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 36, fontWeight: 700, color: COLORS.accent, margin: "16px 0 4px" }}>
            {score !== null ? `${score}分` : "完成"}
          </div>
          <div style={{ color: COLORS.textDim, fontSize: 14, marginBottom: 32 }}>
            共 {total} 题 · 答对 {correctCount} 题 · 错误 {total - correctCount - (total - withAns)} 题
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button className="btn" onClick={() => { setScreen("home"); setShowResult(false); }}
              style={{ padding: "12px 24px", borderRadius: 10, background: COLORS.surface, color: COLORS.text, fontSize: 14 }}>返回首页</button>
            <button className="btn" onClick={() => { setCurrent(0); setShowResult(false); }}
              style={{ padding: "12px 24px", borderRadius: 10, background: COLORS.accent, color: "#0f0e17", fontSize: 14 }}>查看解析</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Quiz ──────────────────────────────────────────────────────────────────────
  if (screen === "quiz" && q) {
    const userAns = answers[qIdx];                        // 已提交的答案字符串
    const isMulti = !!(q.answer?.length > 1 || (q.type === "choice" && q.options?.length > 4));
    const revealed = isPractice && userAns !== undefined;
    // 多选答对：排序后比较；单选直接比较
    const normalize = s => s ? s.split("").sort().join("") : "";
    const isCorrect = q.answer
      ? (isMulti ? normalize(userAns) === normalize(q.answer) : userAns === q.answer)
      : null;

    return (
      <div style={{ minHeight: "100vh", background: COLORS.bg, display: "flex", flexDirection: "column" }}>
        <style>{css}</style>
        {/* Top bar */}
        <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: "14px 24px", display: "flex", alignItems: "center", gap: 16 }}>
          <button className="btn" onClick={() => setScreen("home")}
            style={{ padding: "7px 14px", borderRadius: 8, background: COLORS.card, color: COLORS.neutral, fontSize: 13 }}>← 返回</button>
          <div style={{ flex: 1, height: 6, background: COLORS.border, borderRadius: 99, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress * 100}%`, background: COLORS.accent, borderRadius: 99, transition: "width 0.3s" }} />
          </div>
          <span style={{ fontSize: 13, color: COLORS.neutral, whiteSpace: "nowrap" }}>{current + 1} / {session.indices.length}</span>
          <button className="btn" onClick={() => toggleFlag(qIdx)}
            style={{ fontSize: 18, background: "none", color: flagged.has(qIdx) ? "#f7c59f" : COLORS.border, padding: 4 }}>⭐</button>
        </div>

        {/* Question */}
        <div style={{ flex: 1, maxWidth: 720, width: "100%", margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="fade-up" key={current}>
            <div style={{ fontSize: 11, color: COLORS.textDim, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1.5 }}>
              {q.type === "tf" ? "判断题" : q.type === "fill" ? "填空题" : isMulti ? "多选题（可多选）" : "单选题"}
            </div>
            <div style={{ fontSize: 17, lineHeight: 1.75, color: COLORS.text, fontWeight: 500, marginBottom: 24, padding: "20px 24px", background: COLORS.card, borderRadius: 14, borderLeft: `3px solid ${COLORS.accent}` }}>
              {q.stem}
            </div>

            {/* Options */}
            {q.options.length > 0 ? (
              <MultiOrSingleOptions
                options={q.options}
                isMulti={isMulti}
                userAns={userAns}
                revealed={revealed}
                answer={q.answer}
                onSubmit={(ans) => !revealed && submitAnswer(qIdx, ans)}
              />
            ) : (
              <div style={{ color: COLORS.textDim, padding: "20px", background: COLORS.card, borderRadius: 12, fontSize: 14 }}>
                填空题暂不支持输入，答案：<span style={{ color: COLORS.accent }}>{q.answer || "（无答案）"}</span>
              </div>
            )}

            {/* Feedback */}
            {revealed && (
              <div className="fade-up" style={{ marginTop: 12, textAlign: "center" }}>
                {isCorrect === true && <span style={{ fontSize: 14, color: COLORS.correct, fontWeight: 600 }}>🎉 回答正确！</span>}
                {isCorrect === false && <span style={{ fontSize: 14, color: COLORS.wrong, fontWeight: 600 }}>💡 正确答案是 {q.answer}</span>}
                {isCorrect === null && <span style={{ fontSize: 13, color: COLORS.neutral }}>📝 已作答（无标准答案）</span>}
              </div>
            )}

            {/* Explanation */}
            {revealed && q.explanation && (
              <div className="fade-up" style={{ marginTop: 16, padding: "16px 20px", background: "rgba(82,214,138,0.08)", borderRadius: 12, borderLeft: `3px solid ${COLORS.correct}` }}>
                <div style={{ fontSize: 12, color: COLORS.correct, fontWeight: 700, marginBottom: 6 }}>解析</div>
                <div style={{ fontSize: 14, color: COLORS.neutral, lineHeight: 1.7 }}>{q.explanation}</div>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div style={{ display: "flex", gap: 12, marginTop: "auto", paddingTop: 16 }}>
            <button className="btn" disabled={current === 0} onClick={() => setCurrent(c => c - 1)}
              style={{ flex: 1, padding: "14px 0", borderRadius: 11, background: COLORS.surface, color: current === 0 ? COLORS.border : COLORS.neutral, fontSize: 15, border: `1px solid ${COLORS.border}` }}>
              ← 上一题
            </button>
            {isLast ? (
              <button className="btn" onClick={() => setShowResult(true)}
                style={{ flex: 1, padding: "14px 0", borderRadius: 11, background: COLORS.accent, color: "#0f0e17", fontSize: 15, animation: "pulse 2s infinite" }}>
                完成 🎓
              </button>
            ) : (
              <button className="btn" onClick={() => setCurrent(c => c + 1)}
                style={{ flex: 1, padding: "14px 0", borderRadius: 11, background: COLORS.accent, color: "#0f0e17", fontSize: 15 }}>
                下一题 →
              </button>
            )}
          </div>

          {/* Progress dots */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center", paddingTop: 8 }}>
            {session.indices.slice(0, 60).map((idx, i) => {
              const done = answers[idx] !== undefined;
              const hasA = done && questions[idx]?.answer;
              const ok = hasA && answers[idx] === questions[idx].answer;
              return (
                <div key={i} onClick={() => setCurrent(i)} title={`第${i + 1}题`}
                  style={{ width: 8, height: 8, borderRadius: "50%", cursor: "pointer", flexShrink: 0, background: i === current ? COLORS.accent : hasA ? (ok ? COLORS.correct : COLORS.wrong) : done ? COLORS.neutral : COLORS.border }} />
              );
            })}
            {session.indices.length > 60 && <span style={{ fontSize: 11, color: COLORS.textDim }}>+{session.indices.length - 60}</span>}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Options Component (单选 & 多选) ─────────────────────────────────────────
function MultiOrSingleOptions({ options, isMulti, userAns, revealed, answer, onSubmit }) {
  // pending: 多选时勾选中但未提交的集合
  const [pending, setPending] = useState(new Set());

  // 切题时清空 pending
  useEffect(() => { setPending(new Set()); }, [options]);

  const hasAns = !!answer;

  if (!isMulti) {
    // 单选：点击直接提交
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {options.map(opt => {
          const selected = userAns === opt.label;
          const isRight = answer?.includes(opt.label);
          let bg = COLORS.surface, border = COLORS.border, color = COLORS.text;
          if (revealed) {
            if (hasAns && isRight) { bg = "rgba(82,214,138,0.12)"; border = COLORS.correct; color = COLORS.correct; }
            else if (hasAns && selected && !isRight) { bg = "rgba(255,107,107,0.12)"; border = COLORS.wrong; color = COLORS.wrong; }
            else if (!hasAns && selected) { bg = COLORS.accentSoft; border = COLORS.accent; color = COLORS.accent; }
          } else if (selected) { bg = COLORS.accentSoft; border = COLORS.accent; color = COLORS.accent; }

          return (
            <button key={opt.label} className="btn" disabled={revealed}
              onClick={() => onSubmit(opt.label)}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderRadius: 11, background: bg, border: `1.5px solid ${border}`, color, textAlign: "left", fontSize: 15, width: "100%" }}>
              <span style={{ width: 28, height: 28, borderRadius: "50%", border: `1.5px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{opt.label}</span>
              <span style={{ flex: 1 }}>{opt.text}</span>
              {revealed && hasAns && isRight && <span>✓</span>}
              {revealed && hasAns && selected && !isRight && <span>✗</span>}
            </button>
          );
        })}
      </div>
    );
  }

  // 多选：toggle 勾选，点"确认提交"才算答
  const toggle = (label) => {
    if (revealed) return;
    setPending(prev => {
      const s = new Set(prev);
      s.has(label) ? s.delete(label) : s.add(label);
      return s;
    });
  };

  const confirmMulti = () => {
    if (pending.size === 0 || revealed) return;
    onSubmit([...pending].sort().join(""));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {options.map(opt => {
        // 已提交后用 userAns；提交前用 pending
        const submitted = revealed;
        const selectedPending = !submitted && pending.has(opt.label);
        const selectedDone = submitted && userAns?.includes(opt.label);
        const selected = submitted ? selectedDone : selectedPending;
        const isRight = answer?.includes(opt.label);

        let bg = COLORS.surface, border = COLORS.border, color = COLORS.text;
        if (submitted) {
          if (hasAns && isRight) { bg = "rgba(82,214,138,0.12)"; border = COLORS.correct; color = COLORS.correct; }
          else if (hasAns && selectedDone && !isRight) { bg = "rgba(255,107,107,0.12)"; border = COLORS.wrong; color = COLORS.wrong; }
        } else if (selectedPending) { bg = COLORS.accentSoft; border = COLORS.accent; color = COLORS.accent; }

        // 多选用方形 checkbox 图标
        const checkIcon = selected
          ? <span style={{ fontSize: 14 }}>☑</span>
          : <span style={{ fontSize: 14, color: COLORS.border }}>☐</span>;

        return (
          <button key={opt.label} className="btn" disabled={submitted}
            onClick={() => toggle(opt.label)}
            style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderRadius: 11, background: bg, border: `1.5px solid ${border}`, color, textAlign: "left", fontSize: 15, width: "100%" }}>
            <span style={{ width: 28, height: 28, borderRadius: 7, border: `1.5px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{opt.label}</span>
            <span style={{ flex: 1 }}>{opt.text}</span>
            {submitted && hasAns && isRight && <span>✓</span>}
            {submitted && hasAns && selectedDone && !isRight && <span>✗</span>}
            {!submitted && checkIcon}
          </button>
        );
      })}

      {/* 确认提交按钮 */}
      {!revealed && (
        <button className="btn" disabled={pending.size === 0} onClick={confirmMulti}
          style={{ marginTop: 4, padding: "13px 0", borderRadius: 11, background: pending.size > 0 ? COLORS.accent : COLORS.border, color: pending.size > 0 ? "#0f0e17" : COLORS.textDim, fontSize: 14, width: "100%", transition: "all 0.2s" }}>
          确认提交（已选 {pending.size} 项）
        </button>
      )}
    </div>
  );
}

function ModeCard({ icon, title, desc, color, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button className="btn" onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ padding: "18px 20px", borderRadius: 13, background: hov ? `rgba(${hexToRgb(color)},0.1)` : COLORS.surface, border: `1.5px solid ${hov ? color : COLORS.border}`, textAlign: "left", transition: "all 0.18s", display: "flex", gap: 14, alignItems: "center" }}>
      <span style={{ fontSize: 26 }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, color: hov ? color : COLORS.text }}>{title}</div>
        <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 2 }}>{desc}</div>
      </div>
    </button>
  );
}
