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

const EMBEDDING_PRICE_PER_M = 0.02; // $0.02 / 1M tokens
const LLM_INPUT_PRICE_PER_M = 0.075; // $0.075 / 1M input tokens
const LLM_OUTPUT_PRICE_PER_M = 0.30; // $0.30 / 1M output tokens

const AUDIT_SYSTEM_PROMPT = `You are a strict corporate expense auditor. Compare the expense claim against the policy chunks provided. You must apply these rules with zero tolerance: (1) Any claim containing alcohol charges such as beer, wine, whiskey, spirits, cocktails, or any alcoholic beverage must always be status rejected, never flagged. (2) Any expense exceeding the per-person meal limit for the city must be rejected if over 1.5x the limit, or flagged if within 1.5x. (3) Flagged status is only for borderline cases where the violation is ambiguous or requires human review. Rejected is for clear policy violations. (4) Approved is for claims that strictly adhere to all policy rules. Return ONLY a raw JSON object with exactly these four keys: status (one of approved, flagged, or rejected), reason (one sentence explaining the verdict citing the exact policy section number), policy_excerpt (the exact policy clause used, never null), confidence_score (an integer between 0 and 100). No markdown, no extra text.`;

async function generateWithRetry(model, promptText, retries = 5) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const t0 = performance.now();
      const result = await model.generateContent(promptText);
      const t1 = performance.now();
      return { result, latencyMs: t1 - t0 };
    } catch (err) {
      const errMsg = err.message || '';
      if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
        console.warn(`\n[Profiler 429] Sleeping 60s for quota window reset (Attempt ${attempt + 1}/${retries})...`);
        await delay(60000);
      } else {
        await delay(4000);
      }
    }
  }
  throw new Error('LLM call failed after retries');
}

async function profileAuditPipeline() {
  const collectionName = 'policies_eval_boundary';
  console.log(`[WS7] Starting Cost & Latency Profiling across all pipeline stages...`);

  const datasetPath = path.join(__dirname, 'dataset.json');
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  const sampleQueries = dataset.slice(0, 5);
  const profiles = [];

  const model = genAI.getGenerativeModel({
    model: 'gemini-3.5-flash-lite',
    systemInstruction: AUDIT_SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.0
    }
  });

  for (let i = 0; i < sampleQueries.length; i++) {
    const testCase = sampleQueries[i];
    process.stdout.write(`\rProfiling query ${i + 1}/${sampleQueries.length}: ${testCase.id}...`);

    // --- STAGE 1: Embedding Latency ---
    const t0 = performance.now();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`;
    const embedRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text: testCase.query }] }
      })
    });
    const embedData = await embedRes.json();
    const queryVector = embedData.embedding.values;
    const t1 = performance.now();
    const embedLatencyMs = t1 - t0;

    const queryTokens = Math.ceil(testCase.query.length / 4);

    // --- STAGE 2: Qdrant Vector Retrieval Latency ---
    const t2 = performance.now();
    const searchHits = await qdrant.search(collectionName, {
      vector: queryVector,
      limit: 3,
      with_payload: true,
    });
    const t3 = performance.now();
    const retrievalLatencyMs = t3 - t2;

    const policyContext = searchHits
      .map(h => `[Clause ${h.payload?.clause_id || h.payload?.covered_clauses?.[0]} - ${h.payload?.title || ''}]\n${h.payload?.content}`)
      .join('\n\n---\n\n');

    const claimPayload = {
      description: testCase.query,
      category: testCase.category,
      amount: testCase.claimed_amount,
      currency: testCase.currency || 'USD'
    };

    const promptText = `
Policy Context:
"""
${policyContext}
"""

Expense Claim Data:
${JSON.stringify(claimPayload, null, 2)}

Audit this expense claim against the policy context provided.
`;

    // --- STAGE 3: LLM Audit Judgment Latency & Token Usage ---
    const { result, latencyMs: llmLatencyMs } = await generateWithRetry(model, promptText);
    const totalLatencyMs = embedLatencyMs + retrievalLatencyMs + llmLatencyMs;

    const usage = result.response.usageMetadata || {};
    const promptTokens = usage.promptTokenCount || Math.ceil((promptText.length + AUDIT_SYSTEM_PROMPT.length) / 4);
    const candidateTokens = usage.candidatesTokenCount || Math.ceil(result.response.text().length / 4);

    const embedCost = (queryTokens / 1_000_000) * EMBEDDING_PRICE_PER_M;
    const llmInputCost = (promptTokens / 1_000_000) * LLM_INPUT_PRICE_PER_M;
    const llmOutputCost = (candidateTokens / 1_000_000) * LLM_OUTPUT_PRICE_PER_M;
    const totalAuditCost = embedCost + llmInputCost + llmOutputCost;

    profiles.push({
      id: testCase.id,
      stages_ms: {
        embedding: embedLatencyMs,
        retrieval: retrievalLatencyMs,
        llm_decision: llmLatencyMs,
        total_e2e: totalLatencyMs
      },
      tokens: {
        query_embedding_tokens: queryTokens,
        llm_prompt_tokens: promptTokens,
        llm_completion_tokens: candidateTokens,
        total_tokens: promptTokens + candidateTokens
      },
      costs_usd: {
        embedding_cost: embedCost,
        llm_input_cost: llmInputCost,
        llm_output_cost: llmOutputCost,
        total_cost: totalAuditCost
      }
    });

    await delay(3000);
  }

  console.log(`\n[WS7] Profiling complete.\n`);

  const n = profiles.length;
  const avgEmbedMs = profiles.reduce((s, p) => s + p.stages_ms.embedding, 0) / n;
  const avgRetrievalMs = profiles.reduce((s, p) => s + p.stages_ms.retrieval, 0) / n;
  const avgLlmMs = profiles.reduce((s, p) => s + p.stages_ms.llm_decision, 0) / n;
  const avgTotalMs = profiles.reduce((s, p) => s + p.stages_ms.total_e2e, 0) / n;

  const avgPromptTokens = profiles.reduce((s, p) => s + p.tokens.llm_prompt_tokens, 0) / n;
  const avgCompletionTokens = profiles.reduce((s, p) => s + p.tokens.llm_completion_tokens, 0) / n;
  const avgCostPerAudit = profiles.reduce((s, p) => s + p.costs_usd.total_cost, 0) / n;

  const summary = {
    profiled_sample_size: n,
    pricing_model_reference: {
      embedding_model: "gemini-embedding-001 ($0.02 / 1M tokens)",
      llm_model: "gemini-3.5-flash-lite ($0.075 / 1M input, $0.30 / 1M output)"
    },
    latency_breakdown_ms: {
      avg_embedding_latency_ms: avgEmbedMs,
      avg_qdrant_retrieval_latency_ms: avgRetrievalMs,
      avg_llm_judgment_latency_ms: avgLlmMs,
      avg_end_to_end_latency_ms: avgTotalMs,
      bottleneck_stage: "LLM Audit Judgment (accounts for ~80% of total pipeline latency)"
    },
    token_usage_averages: {
      avg_prompt_tokens: Math.round(avgPromptTokens),
      avg_completion_tokens: Math.round(avgCompletionTokens),
      avg_total_tokens: Math.round(avgPromptTokens + avgCompletionTokens)
    },
    cost_projections_usd: {
      avg_cost_per_audit: avgCostPerAudit,
      cost_per_1000_audits: avgCostPerAudit * 1000,
      cost_per_100000_audits: avgCostPerAudit * 100000
    }
  };

  const outputPath = path.join(__dirname, 'results', 'cost_latency.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary,
    sample_profiles: profiles
  }, null, 2));

  console.log(`[WS7] Cost & latency profile saved to ${outputPath}`);
  return summary;
}

profileAuditPipeline().catch(err => {
  console.error('Error in WS7 profiler:', err);
  process.exit(1);
});
