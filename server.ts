import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import * as pdf from "pdf-parse";
import * as pdfjs from "pdfjs-dist";
import papaparse from "papaparse";
const { parse } = papaparse;
import { Type } from "@google/genai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

// Middleware
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API Routes - Now only for extraction
const extractTextFromPdf = async (buffer: Buffer): Promise<string> => {
  // Try pdf-parse
  try {
    const pdfParser = (pdf as any).default || pdf;
    if (typeof pdfParser === "function") {
      const data = await pdfParser(buffer);
      if (data && data.text) {
        console.log("PDF extraction: pdf-parse SUCCESS");
        return data.text;
      }
    }
  } catch (e) {
    console.error("pdf-parse failed:", e);
  }

  // Try pdfjs-dist
  try {
    const data = new Uint8Array(buffer);
    const loadingTask = pdfjs.getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true
    });
    const doc = await loadingTask.promise;
    let fullText = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item: any) => {
        if ('str' in item) return item.str;
        return '';
      });
      fullText += strings.join(" ") + "\n";
    }
    if (fullText.trim()) {
      console.log("PDF extraction: pdfjs-dist SUCCESS");
      return fullText;
    }
  } catch (e) {
    console.error("pdfjs-dist failed:", e);
  }

  throw new Error("Failed to extract text from PDF using all available engines.");
};

app.post("/api/extract", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    let extractedText = "";
    const mimeType = req.file.mimetype;

    if (mimeType === "application/pdf") {
      extractedText = await extractTextFromPdf(req.file.buffer);
    } else if (mimeType === "text/csv") {
      // For large CSVs, we only need the first few rows to reach our context limit
      const csvData = req.file.buffer.toString('utf8');
      const results = parse(csvData, { 
        header: true,
        preview: 5000 // Limit rows to avoid memory issues
      });
      extractedText = JSON.stringify(results.data);
    } else {
      return res.status(400).json({ error: "Unsupported file type. Please upload PDF or CSV." });
    }

    // Truncate on server to save memory and network
    if (extractedText.length > 500000) {
      extractedText = extractedText.substring(0, 500000);
    }

    if (!extractedText.trim()) {
      return res.status(400).json({ error: "Could not extract text from file." });
    }

    res.json({ text: extractedText });
  } catch (error: any) {
    console.error("Extraction error:", error);
    res.status(500).json({ error: error.message || "An error occurred during file extraction." });
  }
});

// Global Error Handler for API
app.use("/api", (err: any, req: any, res: any, next: any) => {
  console.error("API Error:", err);
  
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: "File is too large. Maximum size is 500MB."
    });
  }

  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
  });
});

// Vite middleware for development
async function startServer() {
  console.log("Starting server...");
  
  if (process.env.NODE_ENV !== "production") {
    console.log("Setting up Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      root: process.cwd(),
    });
    app.use(vite.middlewares);
    
    // Explicit SPA fallback for development
    app.use("*", async (req, res, next) => {
      const url = req.originalUrl;
      if (url.startsWith("/api")) return next();
      
      try {
        let template = fs.readFileSync(path.resolve(__dirname, "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        next(e);
      }
    });
  } else {
    app.use(express.static("dist"));
    app.use("*", (req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`Health check: http://0.0.0.0:${PORT}/api/health`);
  });
}

startServer();
