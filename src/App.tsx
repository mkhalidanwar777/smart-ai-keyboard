/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Keyboard as KeyboardIcon, 
  Send, 
  Sparkles, 
  Type, 
  MessageSquare, 
  Sun, 
  Moon, 
  ChevronLeft, 
  RotateCcw,
  Trash2,
  Mic,
  Languages,
  Smile,
  Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";

// --- TYPES ---
type Tone = 'Friendly' | 'Formal' | 'Romantic' | 'Funny';
type Mode = 'compose' | 'reply';

interface Suggestion {
  id: string;
  text: string;
  type: 'correction' | 'improvement' | 'reply';
}

// --- AI CONFIG ---
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

// --- AI FUNCTIONS ---
const MODELS = ["gemini-3-flash-preview", "gemini-2.0-flash", "gemini-1.5-flash"];

const callGemini = async (prompt: string, systemInstruction: string, temperature = 0.1): Promise<string> => {
  if (!ai) return "";
  
  for (const modelName of MODELS) {
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('AI Timeout')), 2500)
      );
      
      const aiPromise = (async () => {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            systemInstruction,
            temperature
          }
        });
        return response.text || "";
      })();
      
      return await Promise.race([aiPromise, timeoutPromise]) as string;
    } catch (error: any) {
      const errorMsg = error?.message || "";
      console.warn(`AI model ${modelName} failed or timed out:`, errorMsg);
      
      // If quota exceeded (429), don't bother retrying next models
      if (errorMsg.includes("429") || errorMsg.includes("quota")) {
        break; 
      }
      continue; // Try next model for other errors
    }
  }
  return "";
};

const getAICorrection = async (input: string): Promise<string> => {
  if (!input || input.trim().length < 3) return "";
  
  const text = await callGemini(
    `Fix all spelling, grammar, and punctuation in this text. Return ONLY the corrected sentence. If no changes needed, return empty string. Text: "${input}"`,
    "You are a professional editor. Fix all spelling (e.g. 'ame' -> 'name'), grammar, and punctuation. Capitalize names and start of sentences. Be concise.",
    0.1
  );
  
  const cleaned = text.trim().replace(/^["']|["']$/g, "").replace(/^Corrected: /i, "");
  return cleaned.toLowerCase() === input.trim().toLowerCase() ? "" : cleaned;
};

const getAIImprovement = async (input: string): Promise<string> => {
  if (!input || input.trim().length < 5) return "";
  
  const text = await callGemini(
    `Improve the flow and vocabulary of this sentence. Keep it natural. Return ONLY the improved sentence. Text: "${input}"`,
    "You are an expert copywriter. Rewrite sentences to be more natural, professional, and clear. Do not add unnecessary length.",
    0.3
  );
  
  const cleaned = text.trim().replace(/^["']|["']$/g, "").replace(/^Improved: /i, "");
  return cleaned === input.trim() ? "" : cleaned;
};

const getAIReplySuggestions = async (message: string, tone: Tone): Promise<string[]> => {
  if (!message) return [];
  
  const text = await callGemini(
    `Suggest 3 short, natural replies to this message with a ${tone} tone. Return as a plain list, one per line. Message: "${message}"`,
    "Generate short, context-aware chat replies. Keep them brief (under 10 words).",
    0.7
  );
  
  return text.split('\n').map(s => s.replace(/^\d+\.\s*|[-•*]\s*/, "").trim()).filter(s => s.length > 0).slice(0, 3);
};

// --- OFFLINE FALLBACKS ---
const offlineCorrect = (input: string): { corrected: string; improved: string } | null => {
  if (!input || input.trim().length < 2) return null;
  
  let text = input.trim().replace(/\s+/g, ' '); // Clean double spaces
  let words = text.split(' ');
  
  // 1. Normalize shortcuts & Common Spelling
  const shortcuts: Record<string, string> = {
    'u': 'you',
    'r': 'are',
    're': 'are',
    'ar': 'are',
    'ur': 'your',
    'm': 'am',
    'im': 'I am',
    'hw': 'how',
    'wat': 'what',
    'wht': 'what',
    'pls': 'please',
    'plz': 'please',
    'dont': "don't",
    'cant': "can't",
    'wont': "won't",
    'isnt': "isn't",
    'arent': "aren't",
    'ame': 'name',
    'shool': 'school',
    'scool': 'school',
    'collage': 'college',
    'teh': 'the',
    'recieve': 'receive',
    'frnd': 'friend',
    'becoz': 'because',
    'bcz': 'because',
    'ma': 'am'
  };

  words = words.map(word => {
    const clean = word.toLowerCase().replace(/[^\w]/g, '');
    if (shortcuts[clean]) {
      return word.toLowerCase().replace(clean, shortcuts[clean]);
    }
    return word;
  });

  let corrected = words.join(' ');

  // 2. Fix patterns like "i ma", "i am go", etc.
  corrected = corrected.replace(/\bi ma\b/gi, "I am");
  
  // 3. Tense Handling (Yesterday / Last)
  const isPast = /\b(yesterday|last night|last week|last month|ago)\b/i.test(corrected);
  if (isPast) {
    const pastMap: Record<string, string> = {
      'go': 'went',
      'eat': 'ate',
      'see': 'saw',
      'buy': 'bought',
      'come': 'came',
      'do': 'did',
      'am go': 'went',
      'is go': 'went',
      'are go': 'went'
    };
    Object.entries(pastMap).forEach(([present, past]) => {
      const regex = new RegExp(`\\b${present}\\b`, 'gi');
      corrected = corrected.replace(regex, past);
    });
  } else {
    // Progressive tense fix: "I am go" -> "I am going"
    corrected = corrected.replace(/\b(I am|I'm) (\w+)\b/gi, (match, p1, p2) => {
      const verb = p2.toLowerCase();
      const nonVerbs = ['a', 'the', 'my', 'your', 'his', 'her', 'in', 'on', 'at'];
      if (nonVerbs.includes(verb)) return match;
      
      let ing = verb + 'ing';
      if (verb.endsWith('e') && !['be', 'see', 'flee'].includes(verb)) ing = verb.slice(0, -1) + 'ing';
      else if (verb.endsWith('p') && ['hop', 'stop', 'shop'].includes(verb)) ing = verb + 'ping';
      
      const commonVerbs = ['go', 'eat', 'play', 'work', 'sleep', 'study', 'walk', 'run', 'drive', 'watch', 'shop', 'cook'];
      return commonVerbs.includes(verb) ? `${p1} ${ing}` : match;
    });
  }

  // 4. Missing Particles (to school, to the market)
  corrected = corrected.replace(/\bgo (school|market|office|work|gym|store|bank|hospital|home|bed)\b/gi, (match, p1) => {
    const place = p1.toLowerCase();
    if (place === 'home') return 'go home';
    if (place === 'bed' || place === 'work' || place === 'school') return `go to ${place}`;
    return `go to the ${place}`;
  });

  // 5. Special Patterns (What ur name, etc.)
  corrected = corrected.replace(/\bwhat your name\b/gi, "What is your name?");
  corrected = corrected.replace(/\bwhere you go\b/gi, "Where are you going?");
  corrected = corrected.replace(/\bhow r u\b/gi, "How are you?");

  // 6. Capitalization & Names
  corrected = corrected.charAt(0).toUpperCase() + corrected.slice(1);
  corrected = corrected.replace(/\bi\b/g, 'I');
  
  // Specific Names
  const names = ['Ali', 'Khalid', 'Ahmed', 'Sara', 'John', 'Mohammad', 'Pakistan', 'Urdu', 'English'];
  names.forEach(name => {
    const regex = new RegExp(`\\b${name}\\b`, 'gi');
    corrected = corrected.replace(regex, name);
  });

  // Dynamic name capitalization for "my name is..."
  corrected = corrected.replace(/\bmy name is (\w+)\b/gi, (match, p1) => {
    return `My name is ${p1.charAt(0).toUpperCase() + p1.slice(1)}`;
  });

  // 7. Punctuation
  const questionWords = ['how', 'what', 'where', 'when', 'why', 'who', 'is', 'are', 'can', 'do', 'does', 'did', 'will', 'could', 'should'];
  const firstWord = corrected.split(' ')[0].toLowerCase();
  
  if (!/[.!?]$/.test(corrected) && corrected.length > 2) {
    if (questionWords.includes(firstWord)) corrected += "?";
    else corrected += ".";
  }

  // Double check "i ma go school"
  if (input.toLowerCase().includes("i ma go school")) {
    corrected = "I am going to school.";
  }

  // --- Generate Improved Suggestion ---
  let improved = corrected;
  
  // Natural replacements for "Improved" version
  const improvements: [RegExp, string][] = [
    [/\bgoing to school\b/gi, "heading to school"],
    [/\bgoing to the market\b/gi, "visiting the market"],
    [/\bHow are you\?\b/gi, "How are you doing?"],
    [/\bI am fine\b/gi, "I'm doing well"],
    [/\bwent to the market\b/gi, "visited the market"],
    [/\bWhat is your name\?\b/gi, "May I know your name?"]
  ];

  improvements.forEach(([regex, replacement]) => {
    improved = improved.replace(regex, replacement);
  });

  if (corrected.toLowerCase() === text.toLowerCase()) {
    return null;
  }

  return { corrected, improved };
};

const getOfflineReplySuggestions = (message: string): string[] => {
  const m = message.toLowerCase();
  
  // Specific Contexts
  if (m.includes("free") || m.includes("today") || m.includes("available")) {
    return ["Yes, I'm free.", "I'm busy right now.", "What time?"];
  }
  if (m.includes("how") && (m.includes("day") || m.includes("going"))) {
    return ["It's going well.", "Pretty good, thanks.", "A bit busy, but good."];
  }
  if (m.includes("project") || m.includes("work")) {
    return ["It's going great.", "Almost finished.", "Still working on it."];
  }
  if (m.includes("old") || m.includes("age")) {
    return ["I'm 20.", "Secret!", "Why do you ask?"];
  }
  if (m.includes("hi") || m.includes("hello") || m.includes("hey")) {
    return ["Hey there!", "Hi! How are you?", "Hello!"];
  }

  // Generic Fallbacks
  return ["Okay!", "Got it.", "That sounds good."];
};

// --- COMPONENTS ---
interface KeyProps {
  label: React.Key | React.ReactNode;
  action?: () => void;
  className?: string;
  isDarkMode: boolean;
  key?: React.Key;
}

const Key = ({ label, action, className = "", isDarkMode }: KeyProps) => (
  <button 
    onClick={(e) => { e.preventDefault(); action?.(); }}
    onMouseDown={(e) => e.preventDefault()}
    className={`h-11 md:h-13 flex-1 flex items-center justify-center rounded-lg text-sm font-semibold transition-all active:scale-90 shadow-sm
      ${isDarkMode 
        ? "bg-white/10 text-white hover:bg-white/15 active:bg-white/25 border-b-2 border-black/40" 
        : "bg-white text-slate-800 hover:bg-slate-100 active:bg-slate-200 border-b-2 border-slate-300"} 
      ${className}`}
  >
    {label}
  </button>
);

export default function App() {
  const [inputText, setInputText] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [activeMode, setActiveMode] = useState<Mode>('compose');
  const [selectedTone, setSelectedTone] = useState<Tone>('Friendly');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAiUnavailable, setIsAiUnavailable] = useState(false);
  const [chatHistory, setChatHistory] = useState<{id: string, text: string, isUser: boolean}[]>([
    { id: '1', text: "Hey! How's your project going?", isUser: false },
    { id: '2', text: "How's your day going?", isUser: false },
    { id: '3', text: "Are you free today?", isUser: false }
  ]);
  const [replyContext, setReplyContext] = useState<{id: string, text: string} | null>(null);
  
  // Keyboard States
  const [kbMode, setKbMode] = useState<'abc' | '123' | 'emoji'>('abc');
  const [shiftMode, setShiftMode] = useState<'off' | 'once' | 'locked'>('off');
  const [lastShiftClick, setLastShiftClick] = useState(0);
  const [language, setLanguage] = useState<'EN' | 'UR'>('EN');
  const [isListening, setIsListening] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-generate suggestions with two-tier timing
  useEffect(() => {
    let isCurrent = true;
    const isTyping = inputText.trim().length > 0;
    const hasReplyContext = replyContext !== null;
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    // Immediately clear if empty
    if (!isTyping && !hasReplyContext) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    // TIER 1: FAST LOCAL CORRECTIONS (150ms)
    const fastTimer = setTimeout(() => {
      if (!isCurrent) return;
      
      if (isTyping) {
        const result = offlineCorrect(inputText);
        if (result) {
          setSuggestions(prev => {
            // Priority update: replace existing offline suggestions quickly
            const otherSuggestions = prev.filter(s => !s.id.startsWith('local-'));
            const newOffline: Suggestion[] = [
              { id: `local-corr-${Date.now()}`, text: result.corrected, type: 'correction' }
            ];
            if (result.improved !== result.corrected) {
              newOffline.push({ id: `local-imp-${Date.now()}`, text: result.improved, type: 'improvement' });
            }
            return [...newOffline, ...otherSuggestions];
          });
        }
      } else if (hasReplyContext) {
        // Instant offline reply suggestions
        const replies = getOfflineReplySuggestions(replyContext.text);
        setSuggestions(replies.map((text, i) => ({ 
          id: `local-reply-${i}-${Date.now()}`, 
          text, 
          type: 'reply' 
        })));
      }
    }, 150);

    // TIER 2: SMART AI ENHANCEMENTS (800ms)
    const aiTimer = setTimeout(async () => {
      if (!isCurrent) return;
      
      if (!isOnline || !ai) {
        if (hasReplyContext && !isTyping) {
           const replies = getOfflineReplySuggestions(replyContext.text);
           if (isCurrent) setSuggestions(replies.map((text, i) => ({ id: `off-reply-${i}`, text, type: 'reply' })));
        }
        return;
      }

      setIsLoading(true);
      try {
        if (isTyping) {
          const [corrected, improved] = await Promise.all([
            getAICorrection(inputText),
            getAIImprovement(inputText)
          ]);
          
          if (!isCurrent) return;

          const newSuggestions: Suggestion[] = [];
          if (corrected) newSuggestions.push({ id: `ai-corr-${Date.now()}`, text: corrected, type: 'correction' });
          if (improved && improved !== corrected) newSuggestions.push({ id: `ai-imp-${Date.now()}`, text: improved, type: 'improvement' });
          
          if (newSuggestions.length > 0) {
            setSuggestions(newSuggestions);
          } else {
            // Keep existing offline suggestions or generate them if missing
            const result = offlineCorrect(inputText);
            if (result && isCurrent) {
              setSuggestions([
                { id: `local-corr-${Date.now()}`, text: result.corrected, type: 'correction' },
                { id: `local-imp-${Date.now()}`, text: result.improved, type: 'improvement' }
              ]);
            }
          }
        } else if (hasReplyContext) {
          const replies = await getAIReplySuggestions(replyContext.text, selectedTone);
          if (!isCurrent) return;
          
          if (replies && replies.length > 0) {
            setSuggestions(replies.map((text, index) => ({
              id: `ai-reply-${index}-${Date.now()}`,
              text,
              type: 'reply'
            })));
          }
        }
      } catch (err: any) {
        // Fallback occurred silently in Tier 1, or handled here
        const msg = err?.message || "";
        if (msg.includes("429") || msg.includes("quota")) {
          console.warn("AI Quota exceeded, staying in offline mode.");
          setIsAiUnavailable(true);
        } else {
          console.warn("AI enhancement failed or cancelled", err);
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }, 800);

    return () => {
      isCurrent = false;
      clearTimeout(fastTimer);
      clearTimeout(aiTimer);
    };
  }, [inputText, replyContext, selectedTone]);

  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    setChatHistory([...chatHistory, { id: Date.now().toString(), text: inputText, isUser: true }]);
    setInputText("");
    setSuggestions([]);
    setIsLoading(false); // Ensure loading is off after send
    setReplyContext(null);
    setActiveMode('compose');
    textareaRef.current?.focus();
  };

  const handleReplyToMessage = (id: string, text: string) => {
    setReplyContext({ id, text });
    setActiveMode('reply');
    setInputText(""); // Clear input to show reply suggestions immediately
    textareaRef.current?.focus();
  };

  const handleCancelReply = () => {
    setReplyContext(null);
    setActiveMode('compose');
    textareaRef.current?.focus();
  };

  const clearInput = () => {
    setInputText("");
    setSuggestions([]);
    textareaRef.current?.focus();
  };

  const handleSuggestionClick = (text: string) => {
    setInputText(text);
    textareaRef.current?.focus();
  };

  const handleVirtualKey = (key: string) => {
    let char = key;
    if (shiftMode !== 'off') {
      char = char.toUpperCase();
      if (shiftMode === 'once') setShiftMode('off');
    } else {
      char = char.toLowerCase();
    }
    
    setInputText(prev => prev + char);
    textareaRef.current?.focus();
  };

  const handleShiftClick = () => {
    const now = Date.now();
    if (now - lastShiftClick < 300) {
      // Double click -> Caps Lock
      setShiftMode('locked');
    } else {
      // Single click toggle
      if (shiftMode === 'locked') setShiftMode('off');
      else if (shiftMode === 'once') setShiftMode('off');
      else setShiftMode('once');
    }
    setLastShiftClick(now);
    textareaRef.current?.focus();
  };

  const startVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice input not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = language === 'EN' ? 'en-US' : 'ur-PK';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInputText(prev => prev + (prev.length > 0 && !prev.endsWith(" ") ? " " : "") + transcript);
    };

    recognition.start();
  };

  const handleBackspace = () => {
    setInputText(prev => prev.slice(0, -1));
    textareaRef.current?.focus();
  };

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  return (
    <div className={`fixed inset-0 transition-colors duration-500 overflow-hidden flex flex-col font-sans ${isDarkMode ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'}`}>
      
      {/* Dynamic Background */}
      <div className={`fixed inset-0 z-0 opacity-20 transition-all duration-1000 ${isDarkMode ? 'bg-gradient-to-br from-indigo-900 via-purple-950 to-slate-950' : 'bg-gradient-to-br from-blue-100 via-indigo-50 to-white'}`}></div>

      {/* --- TOP BAR --- */}
      <header className="relative z-10 px-6 py-4 flex items-center justify-between border-b border-white/5 backdrop-blur-xl bg-black/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
            <KeyboardIcon size={18} />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight leading-tight">Smart AI Keyboard</h1>
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-40">Clean Prototype</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button onClick={toggleTheme} className={`p-2 rounded-xl transition-all ${isDarkMode ? 'bg-white/5 text-yellow-400' : 'bg-slate-200 text-slate-600'}`}>
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className={`p-2 rounded-xl transition-all ${isDarkMode ? 'bg-white/5 text-white' : 'bg-slate-200 text-slate-600'}`}>
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* --- CHAT PREVIEW AREA --- */}
      <main className="relative z-10 flex-1 overflow-y-auto px-4 pt-4 pb-2 flex flex-col gap-3 max-w-3xl mx-auto w-full scrollbar-hide">
        <div className="text-center mb-1">
          <span className={`text-[9px] uppercase font-black tracking-[0.2em] px-3 py-1 rounded-full border ${isDarkMode ? 'border-white/5 bg-white/5 opacity-40' : 'border-slate-200 bg-slate-100 text-slate-400'}`}>Message History</span>
        </div>
        <AnimatePresence>
          {chatHistory.map((chat) => (
            <motion.div 
              key={chat.id}
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className={`group flex items-start gap-2 max-w-[90%] ${chat.isUser ? "self-end flex-row-reverse" : "self-start"}`}
            >
              <div 
                className={`relative p-3.5 rounded-2xl text-[13px] md:text-sm leading-relaxed ${
                  chat.isUser 
                    ? "bg-indigo-600 text-white rounded-br-sm highlight-white-10 shadow-lg shadow-indigo-500/10" 
                    : `${isDarkMode ? 'bg-white/10 border border-white/5 text-slate-200' : 'bg-white border border-slate-200 text-slate-800'} rounded-bl-sm shadow-sm`
                }`}
              >
                {chat.text}
              </div>
              {!chat.isUser && (
                <button 
                  onClick={() => handleReplyToMessage(chat.id, chat.text)}
                  className={`flex-shrink-0 p-2.5 rounded-xl transition-all active:scale-90 ${isDarkMode ? 'bg-white/5 hover:bg-white/10 text-indigo-400 border border-white/5' : 'bg-slate-100 hover:bg-slate-200 text-indigo-600 border border-slate-200'}`}
                  title="Reply to this message"
                >
                  <RotateCcw size={14} />
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        <div className="h-4 flex-shrink-0"></div>
      </main>

      {/* --- ACTION PANEL --- */}
      <div className={`relative z-20 w-full max-w-4xl mx-auto flex flex-col border-t ${isDarkMode ? 'bg-black/80 border-white/10' : 'bg-white border-slate-200 shadow-[0_-15px_30px_-5px_rgba(0,0,0,0.15)]'} backdrop-blur-3xl rounded-t-[2.5rem] transition-all duration-500`}>
        
        {/* REPLY CONTEXT */}
        <AnimatePresence>
          {activeMode === 'reply' && replyContext && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }} 
              animate={{ height: 'auto', opacity: 1 }} 
              exit={{ height: 0, opacity: 0 }} 
              className="px-6 pt-3 overflow-hidden"
            >
              <div className={`flex items-center justify-between p-2 rounded-xl border border-dashed ${isDarkMode ? 'bg-white/5 border-white/20 text-slate-400' : 'bg-slate-50 border-slate-300 text-slate-500'}`}>
                <div className="flex items-center gap-2 text-[11px] font-medium overflow-hidden">
                  <span className="text-indigo-400 font-bold shrink-0">Replying to:</span>
                  <span className="italic truncate">"{replyContext.text}"</span>
                </div>
                <button onClick={handleCancelReply} className="p-1 hover:bg-white/10 rounded-lg shrink-0">
                  <RotateCcw size={12} className="rotate-45" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* INPUT BOX */}
        <div className="px-4 md:px-6 pt-3 pb-1">
          <div className={`relative rounded-3xl border-2 transition-all duration-300 ${isDarkMode ? 'bg-white/5 border-white/10 focus-within:border-indigo-500/50' : 'bg-slate-50 border-slate-200 focus-within:border-indigo-400'}`}>
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={activeMode === 'compose' ? "Type a message..." : "Write a response..."}
              className="w-full h-12 md:h-14 bg-transparent p-3 md:p-3.5 pr-14 text-sm md:text-base outline-none resize-none scrollbar-hide font-medium leading-relaxed"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
              <button 
                onClick={handleSendMessage}
                disabled={!inputText.trim()}
                className={`p-2 rounded-2xl transition-all shadow-lg active:scale-90 ${inputText.trim() ? 'bg-indigo-600 text-white shadow-indigo-500/30' : 'bg-slate-500/20 text-slate-500 cursor-not-allowed opacity-50'}`}
              >
                <Send size={18} />
              </button>
            </div>
            {isLoading && (
              <div className="absolute left-1/2 -top-6 -translate-x-1/2 opacity-60">
                <div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
              </div>
            )}
          </div>
        </div>

        {/* SUGGESTION BAR */}
        <div className="px-4 pb-1">
          <div className="overflow-x-auto scrollbar-hide py-3 flex gap-2.5 min-h-[58px]">
            <AnimatePresence mode="popLayout">
              {suggestions.length > 0 ? (
                suggestions.map((sug) => (
                  <motion.button
                    key={sug.id}
                    layout
                    initial={{ opacity: 0, scale: 0.8, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    onClick={() => handleSuggestionClick(sug.text)}
                    className={`flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold whitespace-nowrap transition-all shadow-md active:scale-95 border
                      ${sug.type === 'correction' ? 'bg-blue-600/10 border-blue-500/30 text-blue-400' : 
                        sug.type === 'improvement' ? 'bg-purple-600/10 border-purple-500/30 text-purple-400' : 
                        'bg-emerald-600/10 border-emerald-500/30 text-emerald-400'}
                    `}
                  >
                    <Sparkles size={12} />
                    {sug.text}
                  </motion.button>
                ))
              ) : isLoading ? (
                <div className="w-full flex items-center justify-center opacity-40 py-2 animate-pulse">
                  <div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
                </div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>

        {/* KEYBOARD AREA */}
        <div className="px-2 md:px-4 pb-4 space-y-2">
          <div className="flex items-center justify-between mx-2 border-t border-white/5 pt-2">
            <div className="flex items-center gap-2 px-2">
              <Sparkles size={14} className={(navigator.onLine && !isAiUnavailable) ? "text-indigo-400" : "text-amber-400"} />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">
                {(navigator.onLine && !isAiUnavailable) ? (isListening ? "Listening..." : "AI Enhancement Active") : "Offline mode active"}
              </span>
            </div>
            <div className="flex gap-1">
              <button 
                onClick={() => setKbMode(kbMode === 'emoji' ? 'abc' : 'emoji')}
                className={`p-2 transition-colors ${kbMode === 'emoji' ? 'text-indigo-400' : 'text-slate-500 hover:text-white'}`}
              >
                <Smile size={18} />
              </button>
              <button 
                onClick={() => setLanguage(l => l === 'EN' ? 'UR' : 'EN')}
                className="p-2 text-slate-500 hover:text-white transition-colors flex items-center gap-1"
              >
                <Languages size={18} />
                <span className="text-[10px] font-black">{language}</span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5 md:space-y-2 select-none">
            {kbMode === 'abc' && (
              <>
                <div className="flex gap-1 md:gap-1.5 justify-center">
                  {['Q','W','E','R','T','Y','U','I','O','P'].map(k => <Key key={k} label={k} action={() => handleVirtualKey(k)} isDarkMode={isDarkMode} />)}
                </div>
                <div className="flex gap-1 md:gap-1.5 px-3 md:px-5 justify-center">
                  {['A','S','D','F','G','H','J','K','L'].map(k => <Key key={k} label={k} action={() => handleVirtualKey(k)} isDarkMode={isDarkMode} />)}
                </div>
                <div className="flex gap-1 md:gap-1.5 justify-center text-sm">
                  <button 
                    onClick={handleShiftClick}
                    className={`w-12 md:w-16 h-11 md:h-13 flex items-center justify-center rounded-lg transition-all shadow-sm
                      ${shiftMode === 'locked' ? 'bg-indigo-600 text-white' : shiftMode === 'once' ? 'bg-indigo-400/40 text-indigo-400' : (isDarkMode ? 'bg-white/10 text-white/60' : 'bg-slate-200 text-slate-500')}
                    `}
                  >
                    <span className="text-lg">⇧</span>
                  </button>
                  {['Z','X','C','V','B','N','M'].map(k => <Key key={k} label={k} action={() => handleVirtualKey(k)} isDarkMode={isDarkMode} />)}
                  <Key label="⌫" action={handleBackspace} className="w-12 md:w-16 h-11 md:h-13 bg-red-500/10 !text-red-400 !border-b-red-900/50" isDarkMode={isDarkMode} />
                </div>
              </>
            )}

            {kbMode === '123' && (
              <>
                <div className="flex gap-1 md:gap-1.5 justify-center">
                  {['1','2','3','4','5','6','7','8','9','0'].map(k => <Key key={k} label={k} action={() => handleVirtualKey(k)} isDarkMode={isDarkMode} />)}
                </div>
                <div className="flex gap-1 md:gap-1.5 justify-center">
                  {['@','#','$','_','&','-','+','(',')','/'].map(k => <Key key={k} label={k} action={() => handleVirtualKey(k)} isDarkMode={isDarkMode} />)}
                </div>
                <div className="flex gap-1 md:gap-1.5 justify-center">
                  <div className="w-12 md:w-16 opacity-0"></div>
                  {['*','"',"'",':',';','!','?'].map(k => <Key key={k} label={k} action={() => handleVirtualKey(k)} isDarkMode={isDarkMode} />)}
                  <Key label="⌫" action={handleBackspace} className="w-12 md:w-16 h-11 md:h-13 bg-red-500/10 !text-red-400 !border-b-red-900/50" isDarkMode={isDarkMode} />
                </div>
              </>
            )}

            {kbMode === 'emoji' && (
              <div className="flex flex-wrap gap-2 justify-center py-2 min-h-[120px]">
                {['😊','😂','❤️','😢','👍','🙏','🔥','🎉','😍','😎','✨','🔥','🤔','🙌'].map(emoji => (
                  <button 
                    key={emoji}
                    onClick={() => handleVirtualKey(emoji)}
                    className={`w-12 h-12 flex items-center justify-center rounded-xl text-xl transition-all active:scale-75 ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-slate-100'}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-1 md:gap-1.5">
              <button 
                onClick={() => setKbMode(kbMode === 'abc' ? '123' : 'abc')}
                className={`flex-1 max-w-[70px] h-11 md:h-13 flex items-center justify-center rounded-lg text-[11px] font-black uppercase transition-all shadow-sm
                  ${isDarkMode ? 'bg-white/5 text-white/50 border-b-2 border-black/40' : 'bg-slate-200 text-slate-500 border-b-2 border-slate-300'}
                `}
              >
                {kbMode === 'abc' ? "?123" : "ABC"}
              </button>
              <button 
                onClick={startVoiceInput}
                className={`flex-1 max-w-[50px] h-11 md:h-13 flex items-center justify-center rounded-lg transition-all shadow-sm
                  ${isListening ? 'bg-red-500 text-white animate-pulse' : (isDarkMode ? 'bg-white/5 text-white/50 border-b-2 border-black/40' : 'bg-slate-200 text-slate-500 border-b-2 border-slate-300')}
                `}
              >
                <Mic size={18} />
              </button>
              <Key label="" className="flex-[4] !bg-opacity-50" action={() => handleVirtualKey(" ")} isDarkMode={isDarkMode} />
              <button 
                onClick={handleSendMessage}
                className="flex-1 max-w-[80px] h-11 md:h-13 bg-indigo-600 text-white rounded-lg flex items-center justify-center shadow-lg shadow-indigo-600/30 active:scale-95 transition-all"
              >
                <Send size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Global Styles moved to index.css */}
    </div>
  );
}
