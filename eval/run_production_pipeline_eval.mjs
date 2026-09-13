import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { QdrantClient } from '@qdrant/js-client-rest';
import { embedText, runAudit, rerankCandidates } from '../src/lib/ai/gemini.ts';

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

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY,
  checkCompatibility: false,
});

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function runProductionEvaluation() {
  const collectionName = 'policies_eval_boundary';
  console.log('='.repeat(80));
  console.log('🚀 AUDITOR.AI: PRODUCTION-ALIGNED BENCHMARK EVALUATION');
  console.log('   Template: "${category} | at ${merchant} | Purpose: ${purpose} | Amount: ${amount} ${currency}"');
  console.log('   Pipeline: Qdrant Dense Top-10 -> Gemini Cross-Encoder Reranker -> Top-3 -> Gemini Flash Audit');
  console.log('   Target Collection:', collectionName);
  console.log('='.repeat(80) + '\n');

  const datasetPath = path.join(__dirname, 'dataset.json');
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  const cachePath = path.join(__dirname, 'results', 'production_pipeline_eval_cache.json');
  let evaluations = [];
  if (fs.existsSync(cachePath)) {
    try {
      evaluations = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      console.log(`[Cache] Loaded ${evaluations.length} previously evaluated claims from cache.`);
    } catch (e) {
      evaluations = [];
    }
  }

  let fallbackCount = 0;

  for (let i = 0; i < dataset.length; i++) {
    const claim = dataset[i];

    const cachedItem = evaluations.find(e => e.id === claim.id);
    if (cachedItem) {
      process.stdout.write(`\r[Cached] Evaluated ${i + 1}/${dataset.length}: ${claim.id}`);
      if (cachedItem.retrieval?.fallback_triggered) fallbackCount++;
      continue;
    }

    process.stdout.write(`\rEvaluating ${i + 1}/${dataset.length}: ${claim.id}...`);

    // 1. Production Query Text Synthesis
    const queryParts = [
      claim.category,
      claim.merchant ? `at ${claim.merchant}` : '',
      `Purpose: ${claim.business_purpose || claim.query}`,
      claim.claimed_amount || claim.amount ? `Amount: ${claim.claimed_amount || claim.amount} ${claim.currency || 'USD'}` : ''
    ].filter(Boolean);
    const queryText = queryParts.join(' | ');

    // 2. Stage 1: Candidate Retrieval (Qdrant limit: 10)
    const queryVector = await embedText(queryText);
    const initialCandidates = await qdrant.search(collectionName, {
      vector: queryVector,
      limit: 10,
      with_payload: true,
    });

    // 3. Stage 2: Cross-Encoder Reranking
    const top3 = await rerankCandidates(queryText, initialCandidates, 3);
    const isFallback = top3.every(c => c.rerank_score === undefined);
    if (isFallback) fallbackCount++;

    const retrievedClauses = [];
    top3.forEach(hit => {
      const clauses = hit.payload?.covered_clauses || [hit.payload?.clause_id];
      clauses.forEach(c => {
        if (c && !retrievedClauses.includes(c)) retrievedClauses.push(c);
      });
    });

    const expected = claim.expected_clause_ids || [];
    const hitClauses = expected.filter(c => retrievedClauses.includes(c));
    const recallAt3 = expected.length > 0 ? hitClauses.length / expected.length : 1.0;
    const precisionAt3 = retrievedClauses.length > 0 ? hitClauses.length / Math.min(3, retrievedClauses.length) : 0.0;

    let reciprocalRank = 0.0;
    for (let r = 0; r < top3.length; r++) {
      const clauses = top3[r].payload?.covered_clauses || [top3[r].payload?.clause_id];
      if (expected.some(c => clauses.includes(c))) {
        reciprocalRank = 1.0 / (r + 1);
        break;
      }
    }

    // 4. End-to-End Decisioning with Generalized AUDIT_PROMPT
    const policyContext = top3.map(r => r.payload?.content).filter(Boolean).join('\n\n---\n\n');
    const claimPayload = {
      description: claim.business_purpose || claim.query,
      category: claim.category,
      amount: claim.claimed_amount || claim.amount,
      currency: claim.currency || 'USD'
    };

    const verdict = await runAudit(claimPayload, policyContext);

    const actualDecision = (verdict.status || '').toLowerCase().trim();
    const expectedDecision = (claim.expected_decision || '').toLowerCase().trim();
    const isCorrect = actualDecision === expectedDecision;

    const evalResult = {
      id: claim.id,
      query: claim.query,
      production_query_text: queryText,
      category: claim.category,
      difficulty: claim.difficulty,
      expected_clause_ids: expected,
      expected_decision: expectedDecision,
      actual_decision: actualDecision,
      is_correct: isCorrect,
      retrieval: {
        retrieved_clauses: retrievedClauses,
        hit_clauses: hitClauses,
        recall_at_3: recallAt3,
        precision_at_3: precisionAt3,
        mrr: reciprocalRank,
        fallback_triggered: isFallback,
        top_candidates: top3.map(c => ({
          clause_id: c.payload?.clause_id || c.payload?.covered_clauses?.[0],
          dense_score: c.score,
          rerank_score: c.rerank_score
        }))
      },
      audit_verdict: {
        status: verdict.status,
        reason: verdict.reason,
        policy_excerpt: verdict.policy_excerpt,
        confidence_score: verdict.confidence_score
      }
    };

    evaluations.push(evalResult);
    fs.writeFileSync(cachePath, JSON.stringify(evaluations, null, 2));

    await delay(1800);
  }

  console.log(`\n\n[WS Evaluation Complete] All ${evaluations.length} benchmark claims evaluated.\n`);

  // Compute Retrieval Metrics
  const total = evaluations.length;
  const macroRecallAt3 = evaluations.reduce((s, e) => s + e.retrieval.recall_at_3, 0) / total;
  const macroPrecisionAt3 = evaluations.reduce((s, e) => s + e.retrieval.precision_at_3, 0) / total;
  const macroMRR = evaluations.reduce((s, e) => s + e.retrieval.mrr, 0) / total;
  const fallbackActivationRate = fallbackCount / total;

  const calcSubgroup = (diff) => {
    const sub = evaluations.filter(e => e.difficulty === diff);
    if (sub.length === 0) return { count: 0, recall: 0, mrr: 0 };
    return {
      count: sub.length,
      recall: sub.reduce((s, e) => s + e.retrieval.recall_at_3, 0) / sub.length,
      mrr: sub.reduce((s, e) => s + e.retrieval.mrr, 0) / sub.length,
    };
  };

  // Compute Decision Metrics & Confusion Matrix
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

  const correctDecisions = evaluations.filter(e => e.is_correct).length;
  const overallAccuracy = correctDecisions / total;

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

  // Load Baseline Data for Comparison
  let baselineComparison = null;
  const baselinePath = path.join(__dirname, 'results', 'chunking_comparison.json');
  if (fs.existsSync(baselinePath)) {
    const bData = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    baselineComparison = bData.summary;
  }

  const report = {
    timestamp: new Date().toISOString(),
    benchmark_metadata: {
      dataset_size: total,
      query_format: "${category} | at ${merchant} | Purpose: ${purpose} | Amount: ${amount} ${currency}",
      retrieval_architecture: "Qdrant Top-10 -> Gemini Cross-Encoder Reranker -> Top-3",
      decision_architecture: "Gemini 3.5 Flash with Generalized Domain-Level Audit Prompt",
      qdrant_collection: collectionName,
      fallback_activation_rate: fallbackActivationRate
    },
    retrieval_metrics: {
      macro_recall_at_3: macroRecallAt3,
      macro_precision_at_3: macroPrecisionAt3,
      macro_mrr: macroMRR,
      subgroups: {
        easy: calcSubgroup('easy'),
        medium: calcSubgroup('medium'),
        hard: calcSubgroup('hard')
      }
    },
    decision_metrics: {
      overall_accuracy: overallAccuracy,
      confusion_matrix: confusionMatrix,
      class_metrics: classMetrics,
      compliance_risk: {
        prohibited_violations_count: classMetrics.rejected.support,
        rejected_recall: classMetrics.rejected.recall,
        false_approvals_count: falseApprovals,
        compliance_leakage_rate: complianceLeakageRate
      }
    },
    queries: evaluations
  };

  const outputPath = path.join(__dirname, 'results', 'production_pipeline_eval.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  // Console Reporting
  console.log('\n' + '='.repeat(80));
  console.log('📊 PRODUCTION-ALIGNED PIPELINE BENCHMARK RESULTS');
  console.log('='.repeat(80));
  console.log(`\n1. TWO-STAGE RETRIEVAL METRICS:`);
  console.log(`   - Macro Recall@3:            ${(macroRecallAt3 * 100).toFixed(2)}%`);
  console.log(`   - Macro Precision@3:         ${(macroPrecisionAt3 * 100).toFixed(2)}%`);
  console.log(`   - Macro MRR:                 ${macroMRR.toFixed(4)}`);
  console.log(`   - Easy Tier Recall@3:        ${(calcSubgroup('easy').recall * 100).toFixed(2)}%`);
  console.log(`   - Medium Tier Recall@3:      ${(calcSubgroup('medium').recall * 100).toFixed(2)}%`);
  console.log(`   - Hard Tier Recall@3:        ${(calcSubgroup('hard').recall * 100).toFixed(2)}%`);
  console.log(`   - Fallback Activation Rate:  ${(fallbackActivationRate * 100).toFixed(2)}% (${fallbackCount}/${total})`);

  console.log(`\n2. END-TO-END AUDIT DECISION METRICS:`);
  console.log(`   - Overall Classification Accuracy: ${(overallAccuracy * 100).toFixed(2)}% (${correctDecisions}/${total})`);
  console.log(`   - Flagged Class Recall (HITL):     ${(classMetrics.flagged.recall * 100).toFixed(2)}% (${classMetrics.flagged.true_positives}/${classMetrics.flagged.support})`);
  console.log(`   - Rejected Class Recall:           ${(classMetrics.rejected.recall * 100).toFixed(2)}% (${classMetrics.rejected.true_positives}/${classMetrics.rejected.support})`);
  console.log(`   - False Approvals (Leakage):       ${falseApprovals} (${(complianceLeakageRate * 100).toFixed(2)}%)`);

  console.log('\n3. CONFUSION MATRIX:');
  console.log('                    PREDICTED');
  console.log('                Approved  Flagged  Rejected');
  console.log(`  ACTUAL Approved   ${String(confusionMatrix.approved.approved).padStart(4)}     ${String(confusionMatrix.approved.flagged).padStart(4)}     ${String(confusionMatrix.approved.rejected).padStart(4)}`);
  console.log(`         Flagged    ${String(confusionMatrix.flagged.approved).padStart(4)}     ${String(confusionMatrix.flagged.flagged).padStart(4)}     ${String(confusionMatrix.flagged.rejected).padStart(4)}`);
  console.log(`         Rejected   ${String(confusionMatrix.rejected.approved).padStart(4)}     ${String(confusionMatrix.rejected.flagged).padStart(4)}     ${String(confusionMatrix.rejected.rejected).padStart(4)}`);

  console.log('\n' + '='.repeat(80));
  console.log(`Full report saved to: ${outputPath}`);
  console.log('='.repeat(80) + '\n');

  return report;
}

runProductionEvaluation().catch(err => {
  console.error('\nFatal error running production evaluation:', err);
  process.exit(1);
});
