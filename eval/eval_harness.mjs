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
  if (!fs.existsSync(envPath)) {
    throw new Error(`.env.local not found at ${envPath}`);
  }
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim();
        process.env[key] = val;
      }
    }
  });
}

loadEnv();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

if (!GEMINI_API_KEY || !QDRANT_URL || !QDRANT_API_KEY) {
  console.error('Missing required environment variables:', {
    hasGemini: !!GEMINI_API_KEY,
    hasQdrantUrl: !!QDRANT_URL,
    hasQdrantKey: !!QDRANT_API_KEY
  });
  process.exit(1);
}

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY,
});

// 2. Embedding Helper Function using Gemini API
async function embedText(text) {
  // Use gemini-embedding-001 or text-embedding-004
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
    const errText = await response.text();
    // Fallback to text-embedding-004 if gemini-embedding-001 fails
    const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`;
    const fbResponse = await fetch(fallbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text }] }
      })
    });
    if (!fbResponse.ok) {
      throw new Error(`Embedding failed: ${errText}`);
    }
    const fbData = await fbResponse.json();
    return fbData.embedding.values;
  }

  const data = await response.json();
  return data.embedding.values;
}

// 3. Clause Identification in Policy Document
function parseClausesWithPositions(policyText) {
  const clauseRegex = /###\s+(§\d+\.\d+)\s+([^\n]+)/g;
  const matches = [];
  let match;
  while ((match = clauseRegex.exec(policyText)) !== null) {
    matches.push({
      clauseId: match[1],
      title: match[2].trim(),
      startIndex: match.index,
    });
  }

  for (let i = 0; i < matches.length; i++) {
    matches[i].endIndex = (i + 1 < matches.length) ? matches[i + 1].startIndex : policyText.length;
  }

  return matches;
}

function getClausesForRange(start, end, clauses) {
  const covered = new Set();
  for (const c of clauses) {
    if (Math.max(start, c.startIndex) < Math.min(end, c.endIndex)) {
      covered.add(c.clauseId);
    }
  }
  // If no direct clause header inside, find the active preceding clause
  if (covered.size === 0) {
    const preceding = clauses.filter(c => c.startIndex <= start);
    if (preceding.length > 0) {
      covered.add(preceding[preceding.length - 1].clauseId);
    }
  }
  return Array.from(covered);
}

// 4. Ingest Policy with Production Baseline Parameters (500 chars, 50 overlap)
async function ingestBaselinePolicy(collectionName = 'policies_eval_baseline') {
  console.log(`[WS2] Reading corporate_policy.md...`);
  const policyPath = path.join(__dirname, 'corporate_policy.md');
  const policyText = fs.readFileSync(policyPath, 'utf8');

  const clauseMap = parseClausesWithPositions(policyText);
  console.log(`[WS2] Identified ${clauseMap.length} structured clauses in policy corpus.`);

  const chunkSize = 500;
  const overlap = 50;
  const chunks = [];

  for (let i = 0; i < policyText.length; i += chunkSize - overlap) {
    const chunkEnd = Math.min(i + chunkSize, policyText.length);
    const chunkContent = policyText.substring(i, chunkEnd);
    const coveredClauses = getClausesForRange(i, chunkEnd, clauseMap);

    chunks.push({
      id: chunks.length + 1,
      content: chunkContent,
      coveredClauses,
      startOffset: i,
      endOffset: chunkEnd
    });

    if (chunkEnd >= policyText.length) break;
  }

  console.log(`[WS2] Generated ${chunks.length} baseline chunks (500 chars, 50 overlap).`);

  // Get sample embedding to determine vector dimension
  console.log(`[WS2] Generating test embedding to verify vector dimensionality...`);
  const sampleVector = await embedText(chunks[0].content);
  const vectorDim = sampleVector.length;
  console.log(`[WS2] Vector dimension confirmed: ${vectorDim}`);

  // Re-create Qdrant Collection
  try {
    const existing = await qdrant.getCollections();
    if (existing.collections.some(c => c.name === collectionName)) {
      console.log(`[WS2] Deleting existing collection '${collectionName}'...`);
      await qdrant.deleteCollection(collectionName);
    }
  } catch (e) {
    console.warn(`[WS2] Warning checking collections: ${e.message}`);
  }

  console.log(`[WS2] Creating collection '${collectionName}' with dim=${vectorDim}, distance=Cosine...`);
  await qdrant.createCollection(collectionName, {
    vectors: {
      size: vectorDim,
      distance: 'Cosine',
    },
  });

  // Embed and Upsert all chunks
  console.log(`[WS2] Embedding and uploading ${chunks.length} points to Qdrant...`);
  const points = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const vector = i === 0 ? sampleVector : await embedText(chunk.content);
    points.push({
      id: chunk.id,
      vector,
      payload: {
        chunk_index: chunk.id,
        content: chunk.content,
        covered_clauses: chunk.coveredClauses,
        start_offset: chunk.startOffset,
        end_offset: chunk.endOffset,
      }
    });
  }

  await qdrant.upsert(collectionName, {
    wait: true,
    points,
  });

  console.log(`[WS2] Successfully indexed ${points.length} chunks in '${collectionName}'.\n`);
  return { collectionName, chunkCount: chunks.length, vectorDim };
}

// 5. Evaluate Retrieval on all 40 Queries
async function evaluateBaselineRetrieval(collectionName = 'policies_eval_baseline') {
  const datasetPath = path.join(__dirname, 'dataset.json');
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  console.log(`[WS2] Starting retrieval evaluation on ${dataset.length} labeled test cases...`);

  const results = [];

  for (let i = 0; i < dataset.length; i++) {
    const testCase = dataset[i];
    process.stdout.write(`\rEvaluating ${i + 1}/${dataset.length}: ${testCase.id}...`);

    const queryVector = await embedText(testCase.query);

    const searchHits = await qdrant.search(collectionName, {
      vector: queryVector,
      limit: 3,
      with_payload: true,
    });

    const retrievedClauses = [];
    const retrievedChunks = [];

    searchHits.forEach((hit, rankIdx) => {
      const clauses = hit.payload?.covered_clauses || [];
      clauses.forEach(c => {
        if (!retrievedClauses.includes(c)) {
          retrievedClauses.push(c);
        }
      });
      retrievedChunks.push({
        rank: rankIdx + 1,
        chunkId: hit.id,
        score: hit.score,
        clauses,
        snippet: (hit.payload?.content || '').substring(0, 100).replace(/\n/g, ' ') + '...'
      });
    });

    // Compute Metrics for this query
    const expected = testCase.expected_clause_ids;
    const hitClauses = expected.filter(c => retrievedClauses.includes(c));
    const recallAt3 = expected.length > 0 ? hitClauses.length / expected.length : 1.0;
    const precisionAt3 = retrievedClauses.length > 0 ? hitClauses.length / Math.min(3, retrievedClauses.length) : 0.0;

    // MRR: Reciprocal rank of the FIRST chunk that contains at least one expected clause
    let reciprocalRank = 0.0;
    for (let r = 0; r < searchHits.length; r++) {
      const chunkClauses = searchHits[r].payload?.covered_clauses || [];
      const hasMatch = expected.some(c => chunkClauses.includes(c));
      if (hasMatch) {
        reciprocalRank = 1.0 / (r + 1);
        break;
      }
    }

    results.push({
      id: testCase.id,
      query: testCase.query,
      category: testCase.category,
      difficulty: testCase.difficulty,
      expected_clause_ids: expected,
      expected_decision: testCase.expected_decision,
      retrieved_clauses: retrievedClauses,
      hit_clauses: hitClauses,
      recall_at_3: recallAt3,
      precision_at_3: precisionAt3,
      mrr: reciprocalRank,
      retrieved_chunks: retrievedChunks,
      passed: recallAt3 > 0.0,
      full_pass: recallAt3 === 1.0
    });
  }

  console.log(`\n[WS2] Evaluation complete.\n`);

  // Calculate Aggregates
  const total = results.length;
  const avgRecall = results.reduce((sum, r) => sum + r.recall_at_3, 0) / total;
  const avgPrecision = results.reduce((sum, r) => sum + r.precision_at_3, 0) / total;
  const avgMRR = results.reduce((sum, r) => sum + r.mrr, 0) / total;

  // Breakdown by Difficulty
  const calcSubgroup = (diff) => {
    const sub = results.filter(r => r.difficulty === diff);
    if (sub.length === 0) return { count: 0, recall: 0, precision: 0, mrr: 0 };
    return {
      count: sub.length,
      recall: sub.reduce((s, r) => s + r.recall_at_3, 0) / sub.length,
      precision: sub.reduce((s, r) => s + r.precision_at_3, 0) / sub.length,
      mrr: sub.reduce((s, r) => s + r.mrr, 0) / sub.length,
    };
  };

  const aggregateSummary = {
    total_queries: total,
    macro_recall_at_3: avgRecall,
    macro_precision_at_3: avgPrecision,
    macro_mrr: avgMRR,
    subgroups: {
      easy: calcSubgroup('easy'),
      medium: calcSubgroup('medium'),
      hard: calcSubgroup('hard'),
    }
  };

  // Save to eval/results/baseline_retrieval.json
  const resultsDir = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const outputPath = path.join(resultsDir, 'baseline_retrieval.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    collection: collectionName,
    summary: aggregateSummary,
    queries: results
  }, null, 2));

  console.log(`[WS2] Results saved to ${outputPath}`);
  return { summary: aggregateSummary, queries: results };
}

async function main() {
  try {
    await ingestBaselinePolicy('policies_eval_baseline');
    const { summary, queries } = await evaluateBaselineRetrieval('policies_eval_baseline');

    console.log('========================================================================================');
    console.log('WS2 BASELINE RETRIEVAL EVALUATION RESULTS');
    console.log('========================================================================================');
    console.log(`Macro Recall@3:    ${(summary.macro_recall_at_3 * 100).toFixed(2)}%`);
    console.log(`Macro Precision@3: ${(summary.macro_precision_at_3 * 100).toFixed(2)}%`);
    console.log(`Macro MRR:         ${summary.macro_mrr.toFixed(4)}`);
    console.log('----------------------------------------------------------------------------------------');
    console.log(`Easy (n=${summary.subgroups.easy.count}):   Recall@3: ${(summary.subgroups.easy.recall * 100).toFixed(1)}% | Precision@3: ${(summary.subgroups.easy.precision * 100).toFixed(1)}% | MRR: ${summary.subgroups.easy.mrr.toFixed(4)}`);
    console.log(`Medium (n=${summary.subgroups.medium.count}): Recall@3: ${(summary.subgroups.medium.recall * 100).toFixed(1)}% | Precision@3: ${(summary.subgroups.medium.precision * 100).toFixed(1)}% | MRR: ${summary.subgroups.medium.mrr.toFixed(4)}`);
    console.log(`Hard (n=${summary.subgroups.hard.count}):   Recall@3: ${(summary.subgroups.hard.recall * 100).toFixed(1)}% | Precision@3: ${(summary.subgroups.hard.precision * 100).toFixed(1)}% | MRR: ${summary.subgroups.hard.mrr.toFixed(4)}`);
    console.log('========================================================================================');

  } catch (error) {
    console.error('Execution error in WS2 eval harness:', error);
    process.exit(1);
  }
}

main();
