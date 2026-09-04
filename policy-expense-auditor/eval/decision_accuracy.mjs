import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { QdrantClient } from '@qdrant/js-client-rest';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function loadEnv() {
  const envPath = path.join(projectRoot, '.env.local');
  if (!fs.existsSync(envPath)) throw new Error(`.env.local not found at ${envPath}`);
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

loadEnv();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY,
});

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const delay = (ms) => new Promise(res => setTimeout(res, ms));

const AUDIT_PROMPT = `You are a precise corporate expense compliance auditor. Compare the expense claim against the policy context provided. 

Categorize the claim into exactly one of three statuses:
1. "approved": The claim strictly adheres to all stated policy rules and expense caps.
2. "flagged": The claim requires human manager review or supplementary documentation before reimbursement. Use "flagged" for:
   - Claims with missing pre-authorization documentation (e.g., booking without 14-day advance notice, missing VP approval ticket, missing itemized attendee list).
   - Emergency or justified surge exceptions (e.g., weather surge pricing, sold-out standard facilities).
   - Minor dollar overages within 1.5x of the meal or per-diem cap.
3. "rejected": The claim contains explicit, non-reimbursable policy violations. Use "rejected" with zero tolerance for:
   - Any alcohol charges (beer, wine, spirits, cocktails, minibar alcohol).
   - Traffic violations, speeding tickets, and parking meter fines.
   - Luxury travel tiers (First Class airfare, luxury rideshare tiers like Uber Black).
   - Commute expenses between home and primary office.
   - Expenses exceeding allowable caps by more than 1.5x.

Return ONLY a raw JSON object with exactly these four keys:
- status: "approved" | "flagged" | "rejected"
- reason: One clear sentence explaining the verdict citing the exact policy section number (e.g., "§1.2", "§3.1").
- policy_excerpt: The exact policy sentence or clause referenced (never null).
- confidence_score: An integer between 0 and 100 representing confidence in this audit assessment.

No markdown, no backticks, no extra text.`;

async function embedText(text, retries = 4) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text }] }
        })
      });

      if (!response.ok) {
        const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`;
        const fbResponse = await fetch(fallbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'models/text-embedding-004',
            content: { parts: [{ text }] }
          })
        });
        if (!fbResponse.ok) throw new Error(`Embedding failed: ${await response.text()}`);
        const fbData = await fbResponse.json();
        return fbData.embedding.values;
      }

      const data = await response.json();
      return data.embedding.values;
    } catch (e) {
      if (attempt === retries - 1) throw e;
      console.warn(`\n[Embedding Retry ${attempt + 1}/${retries}]: ${e.message}...`);
      await delay(3000 * (attempt + 1));
    }
  }
}

async function runAuditDecision(claimPayload, policyContext, retries = 6) {
  const models = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3-flash-preview'];

  const prompt = `
Policy Context:
"""
${policyContext}
"""

Expense Claim Data:
${JSON.stringify(claimPayload, null, 2)}

Audit this expense claim against the policy context provided.
`;

  for (let attempt = 0; attempt < retries; attempt++) {
    const modelName = models[attempt % models.length];
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: AUDIT_PROMPT,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.0
      }
    });

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      return JSON.parse(text);
    } catch (error) {
      const errMsg = error.message || '';
      if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
        const waitSec = 65;
        console.warn(`\n[WS6 Rate Limit 429 on ${modelName}] Pausing ${waitSec}s for rolling rate window to reset (Attempt ${attempt + 1}/${retries})...`);
        await delay(waitSec * 1000);
      } else {
        console.warn(`\n[WS6 Retrying on ${modelName}]: ${errMsg.substring(0, 60)}...`);
        await delay(4000);
      }
    }
  }

  throw new Error('Exhausted all retries for audit decision');
}

async function runDecisionAccuracyBenchmark() {
  const collectionName = 'policies_eval_boundary';
  console.log(`[WS6] Starting End-to-End Decision Accuracy Benchmark (Calibrated Prompt, Collection: ${collectionName})...`);

  const datasetPath = path.join(__dirname, 'dataset.json');
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  const cachePath = path.join(__dirname, 'results', 'decision_accuracy_cache.json');
  let evaluations = [];
  if (fs.existsSync(cachePath)) {
    try {
      evaluations = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch (e) {
      evaluations = [];
    }
  }

  for (let i = 0; i < dataset.length; i++) {
    const testCase = dataset[i];
    
    const existing = evaluations.find(e => e.id === testCase.id);
    if (existing) {
      process.stdout.write(`\r[Cached] Claim ${i + 1}/${dataset.length}: ${testCase.id}`);
      continue;
    }

    process.stdout.write(`\rAuditing claim ${i + 1}/${dataset.length}: ${testCase.id}...`);

    // 1. Retrieve top-3 policy clauses from Qdrant
    const queryVector = await embedText(testCase.query);
    const searchHits = await qdrant.search(collectionName, {
      vector: queryVector,
      limit: 3,
      with_payload: true,
    });

    const policyContext = searchHits
      .map(h => `[Clause ${h.payload?.clause_id || h.payload?.covered_clauses?.[0]} - ${h.payload?.title || ''}]\n${h.payload?.content}`)
      .join('\n\n---\n\n');

    const claimPayload = {
      description: testCase.query,
      category: testCase.category,
      amount: testCase.claimed_amount,
      currency: testCase.currency || 'USD'
    };

    // 2. Call Gemini for calibrated audit decision
    const verdict = await runAuditDecision(claimPayload, policyContext);

    const actualDecision = verdict.status.toLowerCase().trim();
    const expectedDecision = testCase.expected_decision.toLowerCase().trim();
    const isCorrect = actualDecision === expectedDecision;

    const evalItem = {
      id: testCase.id,
      query: testCase.query,
      category: testCase.category,
      claimed_amount: testCase.claimed_amount,
      expected_clause_ids: testCase.expected_clause_ids,
      expected_decision: expectedDecision,
      actual_decision: actualDecision,
      is_correct: isCorrect,
      confidence_score: verdict.confidence_score,
      reason: verdict.reason,
      policy_excerpt: verdict.policy_excerpt,
      retrieved_clauses: searchHits.map(h => h.payload?.clause_id || h.payload?.covered_clauses?.[0])
    };

    evaluations.push(evalItem);

    // Write incremental cache
    fs.writeFileSync(cachePath, JSON.stringify(evaluations, null, 2));

    await delay(3000);
  }

  console.log(`\n[WS6] Audit evaluation complete for all ${evaluations.length} claims.\n`);

  // Compute Metrics & Confusion Matrix
  const classes = ['approved', 'flagged', 'rejected'];
  const confusionMatrix = {
    approved: { approved: 0, flagged: 0, rejected: 0 },
    flagged: { approved: 0, flagged: 0, rejected: 0 },
    rejected: { approved: 0, flagged: 0, rejected: 0 },
  };

  evaluations.forEach(e => {
    const exp = e.expected_decision;
    const act = e.actual_decision;
    if (confusionMatrix[exp] && confusionMatrix[exp][act] !== undefined) {
      confusionMatrix[exp][act]++;
    }
  });

  const total = evaluations.length;
  const correctCount = evaluations.filter(e => e.is_correct).length;
  const overallAccuracy = correctCount / total;

  // Per-class Precision, Recall, F1
  const classMetrics = {};
  classes.forEach(cls => {
    const tp = confusionMatrix[cls][cls];
    const fp = classes.filter(c => c !== cls).reduce((sum, c) => sum + confusionMatrix[c][cls], 0);
    const fn = classes.filter(c => c !== cls).reduce((sum, c) => sum + confusionMatrix[cls][c], 0);

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    classMetrics[cls] = {
      support: tp + fn,
      true_positives: tp,
      false_positives: fp,
      false_negatives: fn,
      precision,
      recall,
      f1_score: f1
    };
  });

  const falseApprovals = evaluations.filter(e => e.expected_decision === 'rejected' && e.actual_decision === 'approved').length;
  const complianceLeakageRate = classMetrics.rejected.support > 0 ? falseApprovals / classMetrics.rejected.support : 0;

  const summary = {
    total_audits: total,
    overall_accuracy: overallAccuracy,
    confusion_matrix: confusionMatrix,
    class_metrics: classMetrics,
    compliance_risk_analysis: {
      total_violations: classMetrics.rejected.support,
      rejected_class_recall: classMetrics.rejected.recall,
      false_approvals_count: falseApprovals,
      compliance_leakage_rate: complianceLeakageRate,
      interpretation: complianceLeakageRate === 0 
        ? "Zero False Approvals: All prohibited expense violations were successfully intercepted."
        : `Warning: ${falseApprovals} policy violations were erroneously approved.`
    }
  };

  const outputPath = path.join(__dirname, 'results', 'decision_accuracy.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary,
    evaluations
  }, null, 2));

  console.log(`[WS6] Calibrated Decision accuracy results saved to ${outputPath}`);
  return summary;
}

runDecisionAccuracyBenchmark().catch(err => {
  console.error('Error running decision accuracy benchmark:', err);
  process.exit(1);
});
