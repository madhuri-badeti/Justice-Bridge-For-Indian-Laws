import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";


import jwt from "jsonwebtoken";
import { Ollama } from "ollama";
import { randomUUID, randomBytes } from "crypto";
import sharp from "sharp";
import mammoth from "mammoth";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());

/* =========================
     MONGODB CONNECTION
========================= */
const client = new MongoClient(process.env.MONGO_URI);
let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db("ai_legal_assistant");
    console.log("✅ MongoDB Connected");
    
    await createAdmin();


  } catch (err) {
    console.error("❌ MongoDB Connection Failed:", err.message);
    process.exit(1);
  }
}

/* =========================
   🔐 AUTH MIDDLEWARE
========================= */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ error: "Invalid token" });
  }
}

/* =========================} 
   📝 REGISTER
========================= */
app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body;

  const existing = await db.collection("users").findOne({ email });
  if (existing) return res.status(400).json({ error: "User exists" });

  const hashed = await bcrypt.hash(password, 10);
  const userId = randomUUID();

  await db.collection("users").insertOne({
    _id: userId,
    name,
    email,
    password: hashed,
    role: "user",
    createdAt: new Date(),
  });

  res.json({ userId });
});

/* =========================
   🔐 LOGIN
========================= */
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await db.collection("users").findOne({ email });
  if (!user) return res.status(400).json({ error: "User not found" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: "Invalid password" });

  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token, role: user.role, name: user.name });
});

/* =========================
   🤖 OLLAMA SETUP
========================= */
const ollama = new Ollama({
  host: "https://ollama.com",
  headers: { Authorization: "Bearer " + process.env.OLLAMA_API_KEY },
});
/* =========================
   🆕 CREATE SESSION
========================= */
app.post("/api/sessions", authenticate, async (req, res) => {
  const userId = req.user.id;
  let sessionId;

  while (true) {
    const suffix = randomBytes(2).toString("hex");
    sessionId = `${userId}_${suffix}`;
    const exists = await db.collection("sessions").findOne({ sessionId });
    if (!exists) break;
  }

  await db.collection("sessions").insertOne({
    sessionId,
    userId,
    title: "New Consultation",
    createdAt: new Date(),
  });

  res.json({ sessionId });
});

/* =========================
   📂 GET USER SESSIONS
========================= */
app.get("/api/sessions", authenticate, async (req, res) => {
  const sessions = await db.collection("sessions")
    .find({ userId: req.user.id })
    .sort({ createdAt: -1 })
    .toArray();

  res.json(sessions);
});

/* =========================
   📜 GET SESSION MESSAGES
========================= */
app.get("/api/sessions/:sessionId", authenticate, async (req, res) => {
  const { sessionId } = req.params;

  const session = await db.collection("sessions").findOne({
    sessionId,
    userId: req.user.id,
  });

  if (!session) return res.status(404).json({ error: "Session not found" });

  const messages = await db.collection("chats")
    .find({ sessionId })
    .sort({ createdAt: 1 })
    .toArray();

  res.json(messages);
});

/* =========================
   🗑️ DELETE SESSION
========================= */
app.delete("/api/sessions/:sessionId", authenticate, async (req, res) => {
  const { sessionId } = req.params;
  const userId = req.user.id; 

  try {
    // 1. Delete the session document (ensure it belongs to user)
    const result = await db.collection("sessions").deleteOne({ 
      sessionId, 
      userId 
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Session not found or access denied" });
    }

    // 2. Delete all chat messages linked to this session
    await db.collection("chats").deleteMany({ sessionId });

    res.json({ message: "Session deleted" });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   🤖 AI ASK (Images & Documents)
========================= */

app.post("/api/ask", authenticate, upload.array("files"), async (req, res) => {
  const filePaths = []; // Track paths for cleanup

  try {
    const { question, sessionId, mode } = req.body;
    const uploadedFiles = req.files; 
    const userId = req.user.id;

    if (!sessionId) return res.status(400).json({ error: "Session ID required" });

    const previousChats = await db.collection("chats")
      .find({ sessionId })
      .sort({ createdAt: 1 })
      .toArray();

    const historyMessages = previousChats.flatMap(chat => [
      { role: "user", content: chat.question },
      { role: "assistant", content: chat.answer },
    ]);

    const systemPrompt = {
      role: "system",
      content: `
        You are an AI Legal Advisor specialized in Indian Law.
        
        STEP 1: CLASSIFY THE REQUEST
        Determine if the user's input is related to law, legal procedures, court cases, police matters, contracts, or the constitution.

        === SCENARIO A: NON-LEGAL REQUEST ===
        If the input is NOT related to law:
        1. Do NOT use any headers.
        2. Do NOT format the response with the legal structure.
        3. Respond with this specific elaborated refusal:
           "I am a specialized AI Legal Advisor designed strictly to assist with Indian legal matters, court procedures, and document analysis. My capabilities are limited to the legal domain, and I cannot provide assistance with general topics, lifestyle, technology, or creative writing. Please ask a question related to law, legal rights, or official procedures."

        === SCENARIO B: LEGAL REQUEST ===
        If the input IS related to law, you MUST structure your response strictly using these FIVE Markdown headers in this exact order:

        ## Case Summary
        (Provide a quick summary strictly in this format:
        📊 **Case Strength:** [Score] / 10
        ⚠️ **Risks:** [Number] major issues
        📌 **Strong Points:** [One short sentence summarizing the strongest point])

        ## Explanation
        (Provide a clear, neutral legal explanation here).

        ## Risky clauses
        (Highlight potentially dangerous, unfair, or highly liable clauses or situations here).

        ## Important terms
        (Highlight key obligations, deadlines, and core terms here).

        ## Safe clauses
        (Identify standard, protective, or harmless legal clauses or rights here).

        If a section is not applicable, write "None".

        === RESPONSE MODE ===
        The user has requested the response to be delivered in the following mode: "${mode || '⚖️ Legal professional'}".
        Adjust your tone, vocabulary complexity, and focus within the above sections to match this specific mode perfectly. 
        `,
    };

    let extractedText = "";
    const processedImages = [];

    // Process ALL files (Images & Docs)
    if (uploadedFiles && uploadedFiles.length > 0) {
      for (const file of uploadedFiles) {
        filePaths.push(file.path);

        if (file.mimetype.startsWith("image/")) {
          // Compress images using sharp
          const compressedBuffer = await sharp(file.path)
            .resize({ width: 1024, withoutEnlargement: true }) 
            .jpeg({ quality: 80 }) 
            .toBuffer();
          processedImages.push(compressedBuffer.toString("base64"));
          
        } else if (file.mimetype === "application/pdf") {
          try {
            console.log(`📄 Reading PDF: ${file.originalname}`);
            const dataBuffer = fs.readFileSync(file.path);
            
            // 🔥 The Bulletproof Local Require
            const { createRequire } = await import("module");
            const localRequire = createRequire(import.meta.url);
            const parsePdf = localRequire("pdf-parse");
            
            // Execute the parser safely
            const pdfData = await (typeof parsePdf === "function" ? parsePdf(dataBuffer) : parsePdf.default(dataBuffer));
            
            let text = pdfData?.text || "";
            
            // Prevent huge PDFs from crashing the AI
            if (text.length > 15000) {
              console.log("⚠️ PDF is very large. Truncating to prevent AI crash.");
              text = text.substring(0, 15000) + "\n\n... [TEXT TRUNCATED DUE TO LENGTH] ...";
            }
            
            // Verify it's not a scanned image
            if (text.trim().length === 0) {
               throw new Error("PDF read successfully, but it contains 0 words. It is likely a scanned image.");
            }
            
            extractedText += `\n--- Document: ${file.originalname} ---\n${text}\n`;
            console.log("✅ PDF read successfully! Words extracted:", text.split(/\s+/).length);

          } catch (error) {
            console.error("❌ PDF Parsing Error:", error.message);
            extractedText += `\n--- Document: ${file.originalname} ---\n[System Note: Could not extract text from this PDF. It might be a scanned image of a physical document.]\n`;
          }
          
        } else if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
          // Extract text from DOCX
          const docxData = await mammoth.extractRawText({ path: file.path });
          extractedText += `\n--- Document: ${file.originalname} ---\n${docxData.value}\n`;
          
        } else if (file.mimetype === "text/plain") {
          // Read plain text files
          const textData = fs.readFileSync(file.path, "utf8");
          extractedText += `\n--- Document: ${file.originalname} ---\n${textData}\n`;
        }
      }
    }

    // 🔍 DEBUGGING: Check what the backend actually read from the PDF
    console.log("====================================");
    console.log("Extracted Text Length:", extractedText.length);
    if (extractedText.length === 0 && uploadedFiles?.length > 0) {
        console.log("⚠️ WARNING: No text extracted. Is the PDF a scanned image?");
    } else {
        console.log("Text Preview:", extractedText.substring(0, 300) + "...");
    }
    console.log("====================================");

    // 🧠 PSYCHOLOGY FIX: Tell the AI the text is already extracted
    const finalQuestion = extractedText 
      ? `[SYSTEM NOTE: The user has uploaded a document. The text has been automatically extracted and pasted below. Do not say you cannot read documents, just analyze the text provided.]\n\nUser Request: ${question || "Analyze the legal documents."}\n\n=== EXTRACTED DOCUMENT CONTENT ===\n${extractedText}\n=== END OF DOCUMENT ===`
      : question || (processedImages.length > 0 ? "Analyze these images." : "Explain this legally.");

    let userMessage = { role: "user", content: finalQuestion };
    if (processedImages.length > 0) userMessage.images = processedImages;

    // Switch model if ANY images exist
    const modelToUse = (processedImages.length > 0) ? "qwen3-vl:235b-cloud" : "gpt-oss:120b-cloud";

    const response = await ollama.chat({
      model: modelToUse,
      messages: [systemPrompt, ...historyMessages, userMessage],
      stream: false,
    });

    const aiAnswer = response.message.content;

    // Save chat
    await db.collection("chats").insertOne({
      userId,
      sessionId,
      question: question || `[${uploadedFiles?.length || 0} Files Uploaded]`,
      answer: aiAnswer,
      createdAt: new Date(),
    });

    // Cleanup files
    filePaths.forEach((path) => { if (fs.existsSync(path)) fs.unlinkSync(path); });

    // Update title if first message
    const count = await db.collection("chats").countDocuments({ sessionId });
    if (count === 1) {
      await db.collection("sessions").updateOne(
        { sessionId },
        { $set: { title: question?.substring(0, 30) || "Document Analysis" } }
      );
    }

    res.json({ answer: aiAnswer });

  } catch (err) {
    console.error(err);
    filePaths.forEach((path) => { if (fs.existsSync(path)) fs.unlinkSync(path); });
    res.status(500).json({ error: "AI request failed" });
  }
});

/* =========================
   👑 SEED ADMIN USER
========================= */
async function createAdmin() {
  const adminEmail = "admin@legal.ai";
  const existingAdmin = await db.collection("users").findOne({ email: adminEmail });
  
  if (!existingAdmin) {
    const hashed = await bcrypt.hash("admin123", 10); // Default Password
    await db.collection("users").insertOne({
      _id: randomUUID(),
      name: "Super Admin",
      email: adminEmail,
      password: hashed,
      role: "admin", // 👈 Key Role
      createdAt: new Date(),
    });
    console.log("👑 Admin Account Created: admin@legal.ai / admin123");
  }
}
// Call this inside connectDB or just after it connects

/* =========================
   🛡️ ADMIN MIDDLEWARE
========================= */
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Access denied. Admins only." });
  }
  next();
}

/* =========================
   👑 ADMIN ROUTES
========================= */
// 1. Get All Users with Analytics
// 1. Get All Users with Analytics
app.get("/api/admin/users", authenticate, requireAdmin, async (req, res) => {
  try {
    const users = await db.collection("users").aggregate([
      {
        $lookup: {
          from: "chats",
          localField: "_id",
          foreignField: "userId",
          as: "userChats"
        }
      },
      {
        $lookup: {
          from: "sessions",
          localField: "_id",
          foreignField: "userId",
          as: "userSessions"
        }
      },
      {
        $project: {
          name: 1,
          email: 1,
          role: 1,
          totalQueries: { $size: "$userChats" }, 
          totalSessions: { $size: "$userSessions" } 
        }
      }
    ]).toArray();

    res.json(users);
  } catch (err) {
    console.error("Admin fetch error:", err);
    res.status(500).json({ error: "Failed to fetch user analytics" });
  }
});

// 2. Delete User
app.delete("/api/admin/users/:id", authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  
  // Prevent deleting yourself
  if (id === req.user.id) {
    return res.status(400).json({ error: "You cannot delete yourself." });
  }

  await db.collection("users").deleteOne({ _id: id });
  
  // Optional: Delete their sessions and chats too
  await db.collection("sessions").deleteMany({ userId: id });
  await db.collection("chats").deleteMany({ userId: id });

  res.json({ message: "User deleted successfully" });
});

/* =========================
   🚀 START SERVER (CORRECTED)
========================= */
(async () => {
  // 1. Connect to DB first
  await connectDB();

  // 2. Start listening only after DB is ready
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
})();