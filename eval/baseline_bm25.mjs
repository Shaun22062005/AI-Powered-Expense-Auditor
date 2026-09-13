import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Text Tokenizer & Normalizer
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s§.-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

// 2. Load and parse Policy Chunks
function loadPolicyCorpus() {
  const policyPath = path.join(__dirname, 'corporate_policy.md');
  const policyText = fs.readFileSync(policyPath, 'utf8');

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
      if (currentClauseId && currentContentLines.length > 0) {
        chunks.push({
          id: chunks.length + 1,
          category: currentCategory,
          clauseId: currentClauseId,
          title: currentClauseTitle,
          content: `Category: ${currentCategory}\nClause: ${currentClauseId} - ${currentClauseTitle}\n\n${currentContentLines.join('\n').trim()}`,
          tokens: tokenize(`Category: ${currentCategory}\nClause: ${currentClauseId} - ${currentClauseTitle}\n\n${currentContentLines.join('\n').trim()}`)
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

  if (currentClauseId && currentContentLines.length > 0) {
    chunks.push({
      id: chunks.length + 1,
      category: currentCategory,
      clauseId: currentClauseId,
      title: currentClauseTitle,
      content: `Category: ${currentCategory}\nClause: ${currentClauseId} - ${currentClauseTitle}\n\n${currentContentLines.join('\n').trim()}`,
      tokens: tokenize(`Category: ${currentCategory}\nClause: ${currentClauseId} - ${currentClauseTitle}\n\n${currentContentLines.join('\n').trim()}`)
    });
  }

  return chunks;
}

// 3. Okapi BM25 Engine
class BM25 {
  constructor(corpus, k1 = 1.5, b = 0.75) {
    this.corpus = corpus;
    this.k1 = k1;
    this.b = b;
    this.N = corpus.length;
    this.avgdl = corpus.reduce((sum, doc) => sum + doc.tokens.length, 0) / this.N;
    this.docFreqs = {};
    this.idf = {};

    this.computeDocFrequencies();
    this.computeIDF();
  }

  computeDocFrequencies() {
    for (const doc of this.corpus) {
      const seen = new Set(doc.tokens);
      for (const term of seen) {
        this.docFreqs[term] = (this.docFreqs[term] || 0) + 1;
      }
    }
  }

  computeIDF() {
    for (const [term, freq] of Object.entries(this.docFreqs)) {
      this.idf[term] = Math.log((this.N - freq + 0.5) / (freq + 0.5) + 1);
    }
  }

  score(queryTokens, doc) {
    let score = 0.0;
    const docLen = doc.tokens.length;
    const termCounts = {};
    for (const t of doc.tokens) {
      termCounts[t] = (termCounts[t] || 0) + 1;
    }

    for (const term of queryTokens) {
      if (!this.idf[term]) continue;
      const tf = termCounts[term] || 0;
      const idf = this.idf[term];
      const numerator = tf * (this.k1 + 1);
      const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgdl));
      score += idf * (numerator / denominator);
    }
    return score;
  }

  search(query, topK = 3) {
    const queryTokens = tokenize(query);
    const scores = this.corpus.map(doc => ({
      doc,
      score: this.score(queryTokens, doc)
    }));
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }
}

// 4. Run BM25 Benchmark on 40 queries
async function runBM25Benchmark() {
  console.log(`[WS5] Initializing BM25 Lexical Baseline on Policy Corpus...`);
  const corpus = loadPolicyCorpus();
  const bm25 = new BM25(corpus);
  console.log(`[WS5] BM25 Index ready with ${corpus.length} policy documents.`);

  const datasetPath = path.join(__dirname, 'dataset.json');
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  // Load dense baseline results for comparison
  const baselinePath = path.join(__dirname, 'results', 'baseline_retrieval.json');
  const denseData = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

  const bm25Results = [];

  for (let i = 0; i < dataset.length; i++) {
    const testCase = dataset[i];
    const searchHits = bm25.search(testCase.query, 3);

    const retrievedClauses = [];
    searchHits.forEach(h => {
      if (h.doc.clauseId && !retrievedClauses.includes(h.doc.clauseId)) {
        retrievedClauses.push(h.doc.clauseId);
      }
    });

    const expected = testCase.expected_clause_ids;
    const hitClauses = expected.filter(c => retrievedClauses.includes(c));
    const recallAt3 = expected.length > 0 ? hitClauses.length / expected.length : 1.0;
    const precisionAt3 = retrievedClauses.length > 0 ? hitClauses.length / Math.min(3, retrievedClauses.length) : 0.0;

    let reciprocalRank = 0.0;
    for (let r = 0; r < searchHits.length; r++) {
      if (expected.includes(searchHits[r].doc.clauseId)) {
        reciprocalRank = 1.0 / (r + 1);
        break;
      }
    }

    bm25Results.push({
      id: testCase.id,
      query: testCase.query,
      category: testCase.category,
      difficulty: testCase.difficulty,
      expected_clause_ids: expected,
      bm25_retrieved_clauses: retrievedClauses,
      hit_clauses: hitClauses,
      recall_at_3: recallAt3,
      precision_at_3: precisionAt3,
      mrr: reciprocalRank,
      hits: searchHits.map(h => ({ clause: h.doc.clauseId, score: h.score }))
    });
  }

  const total = bm25Results.length;
  const avgRecall = bm25Results.reduce((s, r) => s + r.recall_at_3, 0) / total;
  const avgPrecision = bm25Results.reduce((s, r) => s + r.precision_at_3, 0) / total;
  const avgMRR = bm25Results.reduce((s, r) => s + r.mrr, 0) / total;

  const calcSubgroup = (diff) => {
    const sub = bm25Results.filter(r => r.difficulty === diff);
    return {
      count: sub.length,
      recall: sub.reduce((s, r) => s + r.recall_at_3, 0) / sub.length,
      precision: sub.reduce((s, r) => s + r.precision_at_3, 0) / sub.length,
      mrr: sub.reduce((s, r) => s + r.mrr, 0) / sub.length,
    };
  };

  const summary = {
    total_queries: total,
    bm25_lexical: {
      macro_recall_at_3: avgRecall,
      macro_precision_at_3: avgPrecision,
      macro_mrr: avgMRR,
      easy: calcSubgroup('easy'),
      medium: calcSubgroup('medium'),
      hard: calcSubgroup('hard'),
    },
    dense_vector_baseline: {
      macro_recall_at_3: denseData.summary.macro_recall_at_3,
      macro_precision_at_3: denseData.summary.macro_precision_at_3,
      macro_mrr: denseData.summary.macro_mrr,
      easy: denseData.summary.subgroups.easy,
      medium: denseData.summary.subgroups.medium,
      hard: denseData.summary.subgroups.hard,
    },
    dense_vs_bm25_delta: {
      recall_lift: denseData.summary.macro_recall_at_3 - avgRecall,
      precision_lift: denseData.summary.macro_precision_at_3 - avgPrecision,
      mrr_lift: denseData.summary.macro_mrr - avgMRR,
    }
  };

  const outputPath = path.join(__dirname, 'results', 'bm25_comparison.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary,
    queries: bm25Results
  }, null, 2));

  console.log(`[WS5] BM25 comparison saved to ${outputPath}`);
  return summary;
}

runBM25Benchmark().catch(err => {
  console.error('Error running BM25 benchmark:', err);
  process.exit(1);
});
