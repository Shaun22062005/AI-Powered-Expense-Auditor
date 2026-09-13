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

// 2. Structural Clause-Boundary Aware Chunking (Strategy B)
function createClauseBoundaryChunks(policyText) {
  const lines = policyText.split('\n');
  let currentCategory = '';
  let currentClauseId = '';
  let currentClauseTitle = '';
  let currentContentLines = [];
  const chunks = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('## ') && !line.startsWith('### ')) {
      currentCategory = line.replace('## ', '').trim();
    } else if (line.startsWith('### §')) {
      // Flush previous clause if exists
      if (currentClauseId && currentContentLines.length > 0) {
        const fullClauseText = `Category: ${currentCategory}\nClause: ${currentClauseId} - ${currentClauseTitle}\n\n${currentContentLines.join('\n').trim()}`;
        chunks.push({
          id: chunks.length + 1,
          category: currentCategory,
          clauseId: currentClauseId,
          title: currentClauseTitle,
          content: fullClauseText,
          coveredClauses: [currentClauseId]
        });
      }

      const match = line.match(/###\s+(§\d+\.\d+)\s+([^\n]+)/);
      if (match) {
        currentClauseId = match[1].trim();
        currentClauseTitle = match[2].trim();
        currentContentLines = [];
      }
    } else {
      if (currentClauseId && line.trim()) {
        currentContentLines.push(line);
      }
    }
  }

  // Flush the final clause
  if (currentClauseId && currentContentLines.length > 0) {
    const fullClauseText = `Category: ${currentCategory}\nClause: ${currentClauseId} - ${currentClauseTitle}\n\n${currentContentLines.join('\n').trim()}`;
    chunks.push({
      id: chunks.length + 1,
      category: currentCategory,
      clauseId: currentClauseId,
      title: currentClauseTitle,
      content: fullClauseText,
      coveredClauses: [currentClauseId]
    });
  }

  return chunks;
}

// 3. Ingest Boundary Chunks into Qdrant
async function ingestBoundaryCollection(collectionName = 'policies_eval_boundary') {
  console.log(`[WS3] Reading policy document for Clause-Boundary aware chunking...`);
  const policyPath = path.join(__dirname, 'corporate_policy.md');
  const policyText = fs.readFileSync(policyPath, 'utf8');

  const boundaryChunks = createClauseBoundaryChunks(policyText);
  console.log(`[WS3] Created ${boundaryChunks.length} boundary-aware chunks (one per discrete clause with full header context).`);

  const sampleVector = await embedText(boundaryChunks[0].content);
  const vectorDim = sampleVector.length;

  try {
    const existing = await qdrant.getCollections();
    if (existing.collections.some(c => c.name === collectionName)) {
      console.log(`[WS3] Deleting existing collection '${collectionName}'...`);
      await qdrant.deleteCollection(collectionName);
    }
  } catch (e) {
    console.warn(`[WS3] Warning checking collections: ${e.message}`);
  }

  console.log(`[WS3] Creating collection '${collectionName}' (dim=${vectorDim}, metric=Cosine)...`);
  await qdrant.createCollection(collectionName, {
    vectors: {
      size: vectorDim,
      distance: 'Cosine',
    },
  });

  console.log(`[WS3] Embedding and indexing ${boundaryChunks.length} clause chunks...`);
  const points = [];
  for (let i = 0; i < boundaryChunks.length; i++) {
    const chunk = boundaryChunks[i];
    const vector = i === 0 ? sampleVector : await embedText(chunk.content);
    points.push({
      id: chunk.id,
      vector,
      payload: {
        chunk_id: chunk.id,
        clause_id: chunk.clauseId,
        category: chunk.category,
        title: chunk.title,
        covered_clauses: chunk.coveredClauses,
        content: chunk.content,
      }
    });
  }

  await qdrant.upsert(collectionName, {
    wait: true,
    points,
  });

  console.log(`[WS3] Successfully indexed ${points.length} boundary chunks in '${collectionName}'.\n`);
  return boundaryChunks;
}

// 4. Run Benchmark against Boundary Collection and Compare with Baseline
async function runChunkingComparison() {
  const collectionName = 'policies_eval_boundary';
  await ingestBoundaryCollection(collectionName);

  const datasetPath = path.join(__dirname, 'dataset.json');
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  // Load Baseline results from WS2
  const baselinePath = path.join(__dirname, 'results', 'baseline_retrieval.json');
  if (!fs.existsSync(baselinePath)) {
    throw new Error(`Baseline results not found at ${baselinePath}. Run WS2 first.`);
  }
  const baselineData = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const baselineQueries = baselineData.queries;

  console.log(`[WS3] Evaluating 40 queries on Boundary-Aware Collection...`);
  const challengerResults = [];

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
      const clauses = hit.payload?.covered_clauses || [hit.payload?.clause_id];
      clauses.forEach(c => {
        if (c && !retrievedClauses.includes(c)) {
          retrievedClauses.push(c);
        }
      });
      retrievedChunks.push({
        rank: rankIdx + 1,
        chunkId: hit.id,
        score: hit.score,
        clauses,
        title: hit.payload?.title,
        snippet: (hit.payload?.content || '').substring(0, 100).replace(/\n/g, ' ') + '...'
      });
    });

    const expected = testCase.expected_clause_ids;
    const hitClauses = expected.filter(c => retrievedClauses.includes(c));
    const recallAt3 = expected.length > 0 ? hitClauses.length / expected.length : 1.0;
    const precisionAt3 = retrievedClauses.length > 0 ? hitClauses.length / Math.min(3, retrievedClauses.length) : 0.0;

    let reciprocalRank = 0.0;
    for (let r = 0; r < searchHits.length; r++) {
      const chunkClauses = searchHits[r].payload?.covered_clauses || [searchHits[r].payload?.clause_id];
      const hasMatch = expected.some(c => chunkClauses.includes(c));
      if (hasMatch) {
        reciprocalRank = 1.0 / (r + 1);
        break;
      }
    }

    const baselineCase = baselineQueries.find(q => q.id === testCase.id);

    challengerResults.push({
      id: testCase.id,
      query: testCase.query,
      category: testCase.category,
      difficulty: testCase.difficulty,
      expected_clause_ids: expected,
      expected_decision: testCase.expected_decision,
      baseline: {
        retrieved_clauses: baselineCase?.retrieved_clauses || [],
        hit_clauses: baselineCase?.hit_clauses || [],
        recall_at_3: baselineCase?.recall_at_3 || 0,
        precision_at_3: baselineCase?.precision_at_3 || 0,
        mrr: baselineCase?.mrr || 0,
      },
      challenger_boundary: {
        retrieved_clauses: retrievedClauses,
        hit_clauses: hitClauses,
        recall_at_3: recallAt3,
        precision_at_3: precisionAt3,
        mrr: reciprocalRank,
      },
      delta: {
        recall_at_3: recallAt3 - (baselineCase?.recall_at_3 || 0),
        precision_at_3: precisionAt3 - (baselineCase?.precision_at_3 || 0),
        mrr: reciprocalRank - (baselineCase?.mrr || 0),
      },
      improved: recallAt3 > (baselineCase?.recall_at_3 || 0) || reciprocalRank > (baselineCase?.mrr || 0),
      regressed: recallAt3 < (baselineCase?.recall_at_3 || 0) || reciprocalRank < (baselineCase?.mrr || 0),
    });
  }

  console.log(`\n[WS3] Evaluation complete.\n`);

  // Compute Aggregate Comparisons
  const total = challengerResults.length;
  const bAvgRecall = baselineData.summary.macro_recall_at_3;
  const bAvgPrecision = baselineData.summary.macro_precision_at_3;
  const bAvgMRR = baselineData.summary.macro_mrr;

  const cAvgRecall = challengerResults.reduce((s, r) => s + r.challenger_boundary.recall_at_3, 0) / total;
  const cAvgPrecision = challengerResults.reduce((s, r) => s + r.challenger_boundary.precision_at_3, 0) / total;
  const cAvgMRR = challengerResults.reduce((s, r) => s + r.challenger_boundary.mrr, 0) / total;

  const calcChallengerSubgroup = (diff) => {
    const sub = challengerResults.filter(r => r.difficulty === diff);
    return {
      count: sub.length,
      recall: sub.reduce((s, r) => s + r.challenger_boundary.recall_at_3, 0) / sub.length,
      precision: sub.reduce((s, r) => s + r.challenger_boundary.precision_at_3, 0) / sub.length,
      mrr: sub.reduce((s, r) => s + r.challenger_boundary.mrr, 0) / sub.length,
    };
  };

  const comparisonReport = {
    timestamp: new Date().toISOString(),
    baseline_collection: 'policies_eval_baseline',
    challenger_collection: 'policies_eval_boundary',
    summary: {
      total_queries: total,
      baseline: {
        macro_recall_at_3: bAvgRecall,
        macro_precision_at_3: bAvgPrecision,
        macro_mrr: bAvgMRR,
        easy: baselineData.summary.subgroups.easy,
        medium: baselineData.summary.subgroups.medium,
        hard: baselineData.summary.subgroups.hard,
      },
      challenger_boundary: {
        macro_recall_at_3: cAvgRecall,
        macro_precision_at_3: cAvgPrecision,
        macro_mrr: cAvgMRR,
        easy: calcChallengerSubgroup('easy'),
        medium: calcChallengerSubgroup('medium'),
        hard: calcChallengerSubgroup('hard'),
      },
      delta: {
        delta_recall_at_3: cAvgRecall - bAvgRecall,
        delta_precision_at_3: cAvgPrecision - bAvgPrecision,
        delta_mrr: cAvgMRR - bAvgMRR,
      },
      query_level_changes: {
        improved_queries: challengerResults.filter(r => r.improved).map(r => ({ id: r.id, query: r.query, delta: r.delta })),
        regressed_queries: challengerResults.filter(r => r.regressed).map(r => ({ id: r.id, query: r.query, delta: r.delta })),
        unchanged_count: challengerResults.filter(r => !r.improved && !r.regressed).length
      }
    },
    queries: challengerResults
  };

  // Save to eval/results/chunking_comparison.json
  const outputPath = path.join(__dirname, 'results', 'chunking_comparison.json');
  fs.writeFileSync(outputPath, JSON.stringify(comparisonReport, null, 2));
  console.log(`[WS3] Chunking comparison report saved to ${outputPath}\n`);

  return comparisonReport;
}

runChunkingComparison().catch(err => {
  console.error('Error running chunking experiment:', err);
  process.exit(1);
});
