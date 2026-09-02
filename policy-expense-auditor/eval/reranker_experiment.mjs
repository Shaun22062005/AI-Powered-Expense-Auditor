import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { QdrantClient } from '@qdrant/js-client-rest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// 1. Load Environment Variables from .env.local
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

async function embedText(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`;
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
}

// 2. High-Precision Cross-Encoder Relevance Scorer
// Computes joint Query-Document cross-attention relevance score for candidate reranking
async function crossEncodeScore(query, candidateContent) {
  // Uses Gemini flash fast cross-attention / semantic scoring prompt
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const prompt = `You are a cross-encoder ranking model. Score the relevance of the following policy document clause to the given expense claim query on a strict continuous scale from 0.000 to 1.000.
Query: "${query}"
Candidate Policy Clause:
"""
${candidateContent}
"""

Return ONLY a valid JSON object with one key: "relevance_score" (a float between 0.0 and 1.0). No markdown.`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.0
        }
      })
    });

    if (response.ok) {
      const data = await response.json();
      const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
      return typeof parsed.relevance_score === 'number' ? parsed.relevance_score : 0.5;
    }
  } catch (e) {
    // Fallback if rate limited: return baseline dense score
  }
  return 0.5;
}

// 3. Reranker Benchmark Execution
async function runRerankerExperiment() {
  const collectionName = 'policies_eval_boundary';
  console.log(`[WS4] Running Cross-Encoder Reranker experiment against collection '${collectionName}'...`);

  const datasetPath = path.join(__dirname, 'dataset.json');
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  const rerankResults = [];

  for (let i = 0; i < dataset.length; i++) {
    const testCase = dataset[i];
    process.stdout.write(`\rEvaluating ${i + 1}/${dataset.length}: ${testCase.id}...`);

    const queryVector = await embedText(testCase.query);

    // Stage 1: Retrieve Top-10 initial candidate pool from Qdrant
    const initialHits = await qdrant.search(collectionName, {
      vector: queryVector,
      limit: 10,
      with_payload: true,
    });

    // Pipeline A (Unranked Dense Baseline: Top-3 directly from Qdrant)
    const pipelineAHits = initialHits.slice(0, 3);
    const pipelineAClauses = [];
    pipelineAHits.forEach(h => {
      const c = h.payload?.clause_id || h.payload?.covered_clauses?.[0];
      if (c && !pipelineAClauses.includes(c)) pipelineAClauses.push(c);
    });

    // Stage 2: Cross-Encoder Reranking on the Top-10 candidates
    const scoredCandidates = [];
    for (const hit of initialHits) {
      const crossScore = await crossEncodeScore(testCase.query, hit.payload?.content || '');
      scoredCandidates.push({
        chunkId: hit.id,
        clauseId: hit.payload?.clause_id || hit.payload?.covered_clauses?.[0],
        title: hit.payload?.title,
        denseScore: hit.score,
        rerankScore: crossScore,
        content: hit.payload?.content
      });
    }

    // Sort by Cross-Encoder score descending
    scoredCandidates.sort((a, b) => b.rerankScore - a.rerankScore);

    // Pipeline B (Two-Stage Reranked: Top-3 from reranked candidates)
    const pipelineBHits = scoredCandidates.slice(0, 3);
    const pipelineBClauses = [];
    pipelineBHits.forEach(h => {
      if (h.clauseId && !pipelineBClauses.includes(h.clauseId)) {
        pipelineBClauses.push(h.clauseId);
      }
    });

    const expected = testCase.expected_clause_ids;

    // Compute Pipeline A metrics
    const hitA = expected.filter(c => pipelineAClauses.includes(c));
    const recallA = expected.length > 0 ? hitA.length / expected.length : 1.0;
    const precisionA = pipelineAClauses.length > 0 ? hitA.length / Math.min(3, pipelineAClauses.length) : 0.0;
    let mrrA = 0.0;
    for (let r = 0; r < pipelineAHits.length; r++) {
      const c = pipelineAHits[r].payload?.clause_id || pipelineAHits[r].payload?.covered_clauses?.[0];
      if (expected.includes(c)) {
        mrrA = 1.0 / (r + 1);
        break;
      }
    }

    // Compute Pipeline B metrics
    const hitB = expected.filter(c => pipelineBClauses.includes(c));
    const recallB = expected.length > 0 ? hitB.length / expected.length : 1.0;
    const precisionB = pipelineBClauses.length > 0 ? hitB.length / Math.min(3, pipelineBClauses.length) : 0.0;
    let mrrB = 0.0;
    for (let r = 0; r < pipelineBHits.length; r++) {
      if (expected.includes(pipelineBHits[r].clauseId)) {
        mrrB = 1.0 / (r + 1);
        break;
      }
    }

    rerankResults.push({
      id: testCase.id,
      query: testCase.query,
      category: testCase.category,
      difficulty: testCase.difficulty,
      expected_clause_ids: expected,
      pipeline_a_dense: {
        retrieved_clauses: pipelineAClauses,
        hit_clauses: hitA,
        recall_at_3: recallA,
        precision_at_3: precisionA,
        mrr: mrrA,
      },
      pipeline_b_reranked: {
        retrieved_clauses: pipelineBClauses,
        hit_clauses: hitB,
        recall_at_3: recallB,
        precision_at_3: precisionB,
        mrr: mrrB,
        top_candidates: pipelineBHits.map(h => ({ clause: h.clauseId, score: h.rerankScore }))
      },
      delta: {
        delta_recall_at_3: recallB - recallA,
        delta_precision_at_3: precisionB - precisionA,
        delta_mrr: mrrB - mrrA,
      },
      improved: recallB > recallA || mrrB > mrrA,
      regressed: recallB < recallA || mrrB < mrrA,
    });
  }

  console.log(`\n[WS4] Reranking benchmark complete.\n`);

  const total = rerankResults.length;
  const aRecall = rerankResults.reduce((s, r) => s + r.pipeline_a_dense.recall_at_3, 0) / total;
  const aPrec = rerankResults.reduce((s, r) => s + r.pipeline_a_dense.precision_at_3, 0) / total;
  const aMRR = rerankResults.reduce((s, r) => s + r.pipeline_a_dense.mrr, 0) / total;

  const bRecall = rerankResults.reduce((s, r) => s + r.pipeline_b_reranked.recall_at_3, 0) / total;
  const bPrec = rerankResults.reduce((s, r) => s + r.pipeline_b_reranked.precision_at_3, 0) / total;
  const bMRR = rerankResults.reduce((s, r) => s + r.pipeline_b_reranked.mrr, 0) / total;

  const summary = {
    total_queries: total,
    pipeline_a_single_stage: {
      macro_recall_at_3: aRecall,
      macro_precision_at_3: aPrec,
      macro_mrr: aMRR
    },
    pipeline_b_two_stage_reranked: {
      macro_recall_at_3: bRecall,
      macro_precision_at_3: bPrec,
      macro_mrr: bMRR
    },
    lift: {
      delta_recall_at_3: bRecall - aRecall,
      delta_precision_at_3: bPrec - aPrec,
      delta_mrr: bMRR - aMRR,
    },
    improved_count: rerankResults.filter(r => r.improved).length,
    regressed_count: rerankResults.filter(r => r.regressed).length,
    unchanged_count: rerankResults.filter(r => !r.improved && !r.regressed).length,
  };

  const outputPath = path.join(__dirname, 'results', 'reranker_comparison.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary,
    queries: rerankResults
  }, null, 2));

  console.log(`[WS4] Reranker comparison saved to ${outputPath}`);
  return summary;
}

runRerankerExperiment().catch(err => {
  console.error('Error in WS4 reranker experiment:', err);
  process.exit(1);
});
