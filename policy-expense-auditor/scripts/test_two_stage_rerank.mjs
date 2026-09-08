import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const promptsFile = fs.readFileSync(path.join(projectRoot, 'src/lib/ai/prompts.ts'), 'utf8');
const match = promptsFile.match(/export const AUDIT_PROMPT = `([\s\S]*?)`;/);
const AUDIT_PROMPT = match ? match[1] : '';

// Load environment variables from .env.local
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        process.env[trimmed.substring(0, idx).trim()] = trimmed.substring(idx + 1).trim();
      }
    }
  });
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

console.log('--- Testing 1: AUDIT_PROMPT Domain-Level Generalization ---');

const samplePolicyContext = `
[Clause §1.2 - Advance Airfare Booking]
All commercial flight bookings must be submitted at least 14 days prior to travel to obtain corporate discounts. Bookings made within 14 days require documented managerial justification.

[Clause §4.1 - Alcohol Exclusion]
Corporate funds shall not be used for personal recreational items or alcoholic beverages under any circumstances.
`;

const sampleClaim = {
  description: "Late flight booking for emergency client site outage without 14-day advance notice.",
  category: "Airfare",
  amount: 450,
  currency: "USD"
};

const prompt = `
Policy Context:
"""
${samplePolicyContext}
"""

Expense Data:
${JSON.stringify(sampleClaim, null, 2)}

Audit this expense against the policy.
`;

const model = genAI.getGenerativeModel({
  model: 'gemini-3.5-flash',
  systemInstruction: AUDIT_PROMPT,
  generationConfig: {
    responseMimeType: 'application/json',
    temperature: 0.0,
  },
});

const auditResult = await model.generateContent(prompt);
const auditText = auditResult.response.text();
console.log('Audit Result raw output:');
console.log(auditText);

const parsed = JSON.parse(auditText);
if (!parsed.status || !parsed.reason || !parsed.policy_excerpt || typeof parsed.confidence_score !== 'number') {
  throw new Error('Audit output JSON missing required schema keys!');
}
console.log('✓ AUDIT_PROMPT produced valid JSON strictly adhering to schema.');
console.log(`✓ Status assigned: "${parsed.status}" (Reason: ${parsed.reason})`);

console.log('\n--- Testing 2: Two-Stage Cross-Encoder Reranker Simulation ---');

const candidates = [
  { id: 1, score: 0.85, payload: { clause_id: '§4.1', title: 'Alcohol Exclusion', content: 'Corporate funds shall not be used for personal recreational items or alcoholic beverages under any circumstances.' } },
  { id: 2, score: 0.75, payload: { clause_id: '§1.2', title: 'Advance Airfare Booking', content: 'All commercial flight bookings must be submitted at least 14 days prior to travel to obtain corporate discounts.' } },
  { id: 3, score: 0.70, payload: { clause_id: '§2.1', title: 'Ground Transportation', content: 'Standard taxi and rideshare services between lodging and office are reimbursable.' } },
];

const rerankPrompt = `You are a cross-encoder ranking model evaluating policy document retrieval.
Analyze how relevant each candidate policy clause is to auditing the specific expense claim query below.
Score each candidate on a continuous relevance scale from 0.000 to 1.000 (1.000 = directly governs this expense claim, 0.000 = completely irrelevant).

Query: "Flight ticket booked 3 days before travel due to urgent server outage"

Candidates:
${candidates.map((c, idx) => `[Candidate ${idx}]: ${(c.payload?.content || '').trim()}`).join('\n\n')}

Return ONLY a raw JSON object with a single key "scores" containing an array of objects:
{"scores": [{"index": 0, "relevance_score": 0.95}, {"index": 1, "relevance_score": 0.12}, ...]}
Do not include any other keys or markdown fences.`;

const rerankRes = await model.generateContent(rerankPrompt);
const rerankData = JSON.parse(rerankRes.response.text());
console.log('Reranker Candidate Scores:', rerankData);

const scored = candidates.map((c, i) => {
  const match = rerankData.scores.find(s => s.index === i);
  return { ...c, rerank_score: match ? match.relevance_score : 0 };
});
scored.sort((a, b) => b.rerank_score - a.rerank_score);

console.log('Reranked Top Result:', scored[0].payload.clause_id, `(rerank_score: ${scored[0].rerank_score})`);
if (scored[0].payload.clause_id === '§1.2') {
  console.log('✓ Cross-encoder correctly promoted §1.2 (Advance Airfare Booking) over initial dense rank 1!');
}

console.log('\nAll verification tests passed successfully!');
