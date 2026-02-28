import React, { useState, useRef } from "react";
import { 
  Upload, 
  Search, 
  ShieldAlert, 
  Layout, 
  Loader2, 
  FileText, 
  AlertCircle,
  CheckCircle2,
  ChevronRight
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI, Type } from "@google/genai";
import * as pdfjsLib from "pdfjs-dist";
import papaparse from "papaparse";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

interface AnalysisResult {
  hunter_findings: string;
  skeptic_report: string;
  statistical_proof: string;
  comparison_matrix: string;
  trust_score: number;
  final_synthesis: string;
}

const SYSTEM_INSTRUCTION = `You are a Research Swarm consisting of three elite agents specialized in high-stakes comparative analysis:

1. Hunter (Data Scientist): Your sole mission is to extract hard statistical proof, raw metrics, percentages, and verifiable data points from BOTH documents. Do not provide fluff. If data is missing, state it explicitly.
2. Skeptic (Critical Auditor): You are aggressively critical. Identify every contradiction, logical fallacy, and inconsistency between the documents. Challenge the validity of the data provided by the Hunter. Look for what is NOT being said.
3. Architect (Strategic Lead): Synthesizes the data and the critique into a brutal, honest, and coherent final report. Prioritize hard evidence over narrative.

Calculate the "trust_score" (0-100) using the following weighted formula:
- 40% Agent Agreement: How much do the agents agree on the core findings?
- 30% Evidence Strength: How robust and verifiable is the data found?
- 20% Internal Consistency: Are there contradictions within the documents themselves?
- 10% Data Completeness: Are there significant gaps in the provided information?

Output ONLY raw, unformatted JSON. No conversational text, no markdown code blocks.
JSON Schema:
{
  "hunter_findings": "string (summary of core facts)",
  "statistical_proof": "string (bulleted list of hard metrics, percentages, and data points found in both)",
  "skeptic_report": "string (aggressive critique of contradictions and data gaps)",
  "comparison_matrix": "string (structured technical comparison)",
  "trust_score": "integer (0-100 based on the weighted formula above)",
  "final_synthesis": "string (final report answering the user question with aggressive reasoning)"
}`;

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const analyzeWithSwarm = async (documents: { name: string, text: string }[], userTopic: string) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Gemini API key is not configured.");
    }

    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview";

    const combinedContext = documents.map(doc => `--- DOCUMENT: ${doc.name} ---\n${doc.text.substring(0, 300000)}`).join("\n\n");
    const prompt = `User Question/Topic: ${userTopic}\n\nAnalyze and compare the following documents:\n\n${combinedContext}`;

    let attempt = 0;
    const maxRetries = 3;

    while (attempt < maxRetries) {
      try {
        const response = await ai.models.generateContent({
          model: model,
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                hunter_findings: { type: Type.STRING },
                statistical_proof: { type: Type.STRING },
                skeptic_report: { type: Type.STRING },
                comparison_matrix: { type: Type.STRING },
                trust_score: { type: Type.INTEGER },
                final_synthesis: { type: Type.STRING },
              },
              required: ["hunter_findings", "statistical_proof", "skeptic_report", "comparison_matrix", "trust_score", "final_synthesis"],
            },
          },
        });

        const resultText = response.text;
        if (!resultText) throw new Error("Empty response from AI");
        return JSON.parse(resultText) as AnalysisResult;
      } catch (err: any) {
        if (err.message?.includes("429") || err.status === 429) {
          attempt++;
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          throw err;
        }
      }
    }
    throw new Error("Max retries exceeded for AI analysis.");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setFiles(prev => [...prev, ...newFiles].slice(0, 2));
      setError(null);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    if (!topic.trim()) {
      setError("Please define a topic or question for analysis.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    
    try {
      const extractedDocs: { name: string, text: string }[] = [];

      for (const file of files) {
        setStatus(`Processing ${file.name}...`);
        let text = "";

        if (file.type === "text/csv" || file.name.endsWith(".csv")) {
          text = await new Promise((resolve, reject) => {
            papaparse.parse(file, {
              header: true,
              preview: 2000, // Limit rows for context
              complete: (results) => resolve(JSON.stringify(results.data)),
              error: (err) => reject(err)
            });
          });
        } else if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
          const arrayBuffer = await file.arrayBuffer();
          const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
          const pdf = await loadingTask.promise;
          let fullText = "";
          // Extract from first 50 pages to stay within context limits
          const pagesToExtract = Math.min(pdf.numPages, 50);
          for (let i = 1; i <= pagesToExtract; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const strings = content.items.map((item: any) => item.str || "");
            fullText += strings.join(" ") + "\n";
          }
          text = fullText;
        } else {
          throw new Error(`Unsupported file type: ${file.name}`);
        }

        if (!text || !text.trim()) {
          throw new Error(`Could not extract text from ${file.name}`);
        }

        extractedDocs.push({ name: file.name, text });
      }
      
      setStatus("Swarm agents comparing documents...");
      const analysis = await analyzeWithSwarm(extractedDocs, topic);
      setResult(analysis);
    } catch (err: any) {
      console.error("Analysis error:", err);
      setError(err.message || "An unexpected error occurred during processing.");
    } finally {
      setLoading(false);
      setStatus("");
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="min-h-screen bg-[#0e1117] text-white font-sans selection:bg-[#58a6ff]/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-[#0e1117]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#58a6ff] rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(88,166,255,0.3)]">
              <Layout className="w-5 h-5 text-[#0e1117]" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Research Swarm <span className="text-[#58a6ff] text-sm font-mono ml-2 opacity-70">v2.0</span></h1>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm text-white/50">
            <span className="hover:text-white transition-colors cursor-pointer">Documentation</span>
            <span className="hover:text-white transition-colors cursor-pointer">API</span>
            <div className="h-4 w-px bg-white/10"></div>
            <div className="flex items-center gap-2 text-[#58a6ff]">
              <div className="w-2 h-2 bg-[#58a6ff] rounded-full animate-pulse"></div>
              <span>System Active</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          
          {/* Sidebar / Config */}
          <div className="lg:col-span-4 space-y-8">
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-white/40 mb-4">Orchestrator Config</h2>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6">
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">Model Selection</label>
                  <div className="bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm flex items-center justify-between">
                    <span>Gemini 2.0 Flash</span>
                    <ChevronRight className="w-4 h-4 text-white/30" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">Swarm Agents</label>
                  <div className="space-y-2">
                    {['Hunter', 'Skeptic', 'Architect'].map((agent) => (
                      <div key={agent} className="flex items-center gap-3 text-sm bg-white/5 px-3 py-2 rounded-lg border border-white/5">
                        <CheckCircle2 className="w-4 h-4 text-[#58a6ff]" />
                        <span>{agent}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-white/40 mb-4">Analysis Topic</h2>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <textarea
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="What should the swarm compare? (e.g., 'Compare the financial performance and future outlook of these two companies')"
                  className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#58a6ff] transition-colors resize-none h-24"
                />
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-white/40 mb-4">Input Stream</h2>
              <div 
                onClick={triggerFileInput}
                className={`
                  relative group cursor-pointer border-2 border-dashed rounded-2xl p-6 transition-all duration-300
                  ${files.length > 0 ? 'border-[#58a6ff] bg-[#58a6ff]/5' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'}
                `}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  className="hidden" 
                  accept=".pdf,.csv"
                  multiple
                />
                <div className="flex flex-col items-center text-center">
                  <div className={`
                    w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110
                    ${files.length > 0 ? 'bg-[#58a6ff] text-[#0e1117]' : 'bg-white/5 text-white/40'}
                  `}>
                    <Upload className="w-6 h-6" />
                  </div>
                  <p className="font-medium mb-1">{files.length > 0 ? `${files.length} File(s) Selected` : "Upload Documents"}</p>
                  <p className="text-xs text-white/40">Large PDF or CSV files supported (Max 2)</p>
                </div>
              </div>

              {files.length > 0 && (
                <div className="mt-4 space-y-2">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm">
                      <div className="flex items-center gap-2 truncate">
                        <FileText className="w-4 h-4 text-[#58a6ff]" />
                        <span className="truncate">{f.name}</span>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                        className="text-white/40 hover:text-red-400 transition-colors"
                      >
                        <AlertCircle className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                disabled={files.length === 0 || !topic.trim() || loading}
                onClick={handleUpload}
                className={`
                  w-full mt-4 py-4 rounded-2xl font-semibold transition-all flex items-center justify-center gap-2
                  ${files.length === 0 || !topic.trim() || loading 
                    ? 'bg-white/5 text-white/20 cursor-not-allowed' 
                    : 'bg-[#58a6ff] text-[#0e1117] hover:bg-[#70b5ff] shadow-[0_0_20px_rgba(88,166,255,0.2)] hover:shadow-[0_0_30px_rgba(88,166,255,0.4)]'}
                `}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Analyzing...</span>
                  </>
                ) : (
                  <span>Initialize Comparison</span>
                )}
              </button>
              
              {files.length > 0 && !loading && (
                <button 
                  onClick={() => { setFiles([]); setResult(null); setError(null); }}
                  className="w-full mt-2 py-2 text-xs text-white/30 hover:text-red-400 transition-colors"
                >
                  Clear All Files
                </button>
              )}
            </section>
          </div>

          {/* Main Content / Results */}
          <div className="lg:col-span-8">
            <AnimatePresence mode="wait">
              {!result && !loading && !error && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="h-[500px] border border-white/5 rounded-3xl flex flex-col items-center justify-center text-center p-12 bg-white/[0.01]"
                >
                  <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
                    <FileText className="w-10 h-10 text-white/20" />
                  </div>
                  <h3 className="text-2xl font-light text-white/60 mb-2">Awaiting Intelligence Input</h3>
                  <p className="max-w-md text-white/30">Upload a research document to activate the multi-agent swarm analysis engine.</p>
                </motion.div>
              )}

              {loading && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-6"
                >
                  <div className="bg-white/5 border border-white/10 rounded-3xl p-12 flex flex-col items-center justify-center text-center">
                    <div className="relative w-24 h-24 mb-8">
                      <div className="absolute inset-0 border-4 border-[#58a6ff]/20 rounded-full"></div>
                      <div className="absolute inset-0 border-4 border-[#58a6ff] rounded-full border-t-transparent animate-spin"></div>
                      <div className="absolute inset-4 bg-[#58a6ff]/10 rounded-full flex items-center justify-center">
                        <Search className="w-8 h-8 text-[#58a6ff]" />
                      </div>
                    </div>
                    <h3 className="text-xl font-medium mb-2">{status}</h3>
                    <p className="text-white/40 animate-pulse">Synchronizing neural weights across agents...</p>
                  </div>
                </motion.div>
              )}

              {error && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-red-500/10 border border-red-500/20 rounded-3xl p-8 flex items-start gap-6"
                >
                  <div className="w-12 h-12 bg-red-500 rounded-2xl flex items-center justify-center shrink-0">
                    <AlertCircle className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-red-400 mb-2">Analysis Failed</h3>
                    <p className="text-red-400/70 leading-relaxed">{error}</p>
                    <button 
                      onClick={() => setError(null)}
                      className="mt-4 text-sm font-medium text-red-400 underline underline-offset-4 hover:text-red-300"
                    >
                      Dismiss and retry
                    </button>
                  </div>
                </motion.div>
              )}

              {result && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-8"
                >
                  {/* Trust Score Banner */}
                  <div className={`bg-gradient-to-r ${
                    result.trust_score >= 80 ? 'from-emerald-500/20' : result.trust_score >= 50 ? 'from-orange-500/20' : 'from-red-500/20'
                  } to-transparent border ${
                    result.trust_score >= 80 ? 'border-emerald-500/20' : result.trust_score >= 50 ? 'border-orange-500/20' : 'border-red-500/20'
                  } rounded-3xl p-8 flex items-center justify-between`}>
                    <div className="flex items-center gap-6">
                      <div className="relative w-20 h-20">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle
                            cx="40"
                            cy="40"
                            r="36"
                            stroke="currentColor"
                            strokeWidth="8"
                            fill="transparent"
                            className="text-white/5"
                          />
                          <circle
                            cx="40"
                            cy="40"
                            r="36"
                            stroke="currentColor"
                            strokeWidth="8"
                            fill="transparent"
                            strokeDasharray={226}
                            strokeDashoffset={226 - (226 * result.trust_score) / 100}
                            className={`${
                              result.trust_score >= 80 ? 'text-emerald-500' : result.trust_score >= 50 ? 'text-orange-500' : 'text-red-500'
                            } transition-all duration-1000 ease-out`}
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center font-bold text-xl">
                          {result.trust_score}%
                        </div>
                      </div>
                      <div>
                        <h3 className="text-2xl font-semibold">Trust Score</h3>
                      </div>
                    </div>
                  </div>

                  {/* Agent Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Hunter Card */}
                    <div className="bg-white/5 border border-white/10 rounded-3xl p-8 hover:border-emerald-500/30 transition-colors group">
                      <div className="flex items-center gap-4 mb-6">
                        <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500 group-hover:scale-110 transition-transform">
                          <Search className="w-6 h-6" />
                        </div>
                        <h4 className="text-lg font-semibold">Hunter Findings</h4>
                      </div>
                      <p className="text-white/60 leading-relaxed text-sm whitespace-pre-wrap">{result.hunter_findings}</p>
                    </div>

                    {/* Statistical Proof Card */}
                    <div className="bg-white/5 border border-white/10 rounded-3xl p-8 hover:border-cyan-500/30 transition-colors group">
                      <div className="flex items-center gap-4 mb-6">
                        <div className="w-12 h-12 bg-cyan-500/10 rounded-2xl flex items-center justify-center text-cyan-500 group-hover:scale-110 transition-transform">
                          <CheckCircle2 className="w-6 h-6" />
                        </div>
                        <h4 className="text-lg font-semibold">Statistical Proof</h4>
                      </div>
                      <div className="text-cyan-400/90 font-mono text-xs leading-relaxed whitespace-pre-wrap bg-black/20 p-4 rounded-xl border border-cyan-500/10">
                        {result.statistical_proof}
                      </div>
                    </div>

                    {/* Skeptic Card */}
                    <div className="bg-white/5 border border-white/10 rounded-3xl p-8 hover:border-orange-500/30 transition-colors group">
                      <div className="flex items-center gap-4 mb-6">
                        <div className="w-12 h-12 bg-orange-500/10 rounded-2xl flex items-center justify-center text-orange-500 group-hover:scale-110 transition-transform">
                          <ShieldAlert className="w-6 h-6" />
                        </div>
                        <h4 className="text-lg font-semibold">Aggressive Critique</h4>
                      </div>
                      <p className="text-white/60 leading-relaxed text-sm whitespace-pre-wrap italic">{result.skeptic_report}</p>
                    </div>

                    {/* Comparison Matrix */}
                    <div className="bg-white/5 border border-white/10 rounded-3xl p-8 hover:border-blue-500/30 transition-colors group">
                      <div className="flex items-center gap-4 mb-6">
                        <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform">
                          <Layout className="w-6 h-6" />
                        </div>
                        <h4 className="text-lg font-semibold">Comparison Matrix</h4>
                      </div>
                      <div className="prose prose-invert max-w-none">
                        <p className="text-white/80 leading-relaxed whitespace-pre-wrap text-sm">{result.comparison_matrix}</p>
                      </div>
                    </div>
                  </div>

                  {/* Architect Synthesis */}
                  <div className="bg-white/5 border border-white/10 rounded-3xl p-8 hover:border-purple-500/30 transition-colors group">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-12 h-12 bg-purple-500/10 rounded-2xl flex items-center justify-center text-purple-500 group-hover:scale-110 transition-transform">
                        <FileText className="w-6 h-6" />
                      </div>
                      <h4 className="text-lg font-semibold">Architect Synthesis</h4>
                    </div>
                    <div className="prose prose-invert max-w-none">
                      <p className="text-white/80 leading-relaxed whitespace-pre-wrap">{result.final_synthesis}</p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-white/5 mt-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 text-white/30 text-sm">
          <p>© 2024 Advanced AI Research Swarm. Powered by Gemini 2.0 Flash.</p>
          <div className="flex items-center gap-8">
            <span className="hover:text-white transition-colors cursor-pointer">Privacy Policy</span>
            <span className="hover:text-white transition-colors cursor-pointer">Terms of Service</span>
            <span className="hover:text-white transition-colors cursor-pointer">Contact Support</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
