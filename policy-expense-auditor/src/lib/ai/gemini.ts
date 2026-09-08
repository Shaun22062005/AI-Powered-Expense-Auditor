import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { OCR_SYSTEM_PROMPT, AUDIT_PROMPT } from './prompts';

const apiKey = process.env.GEMINI_API_KEY!;
const genAI = new GoogleGenerativeAI(apiKey);

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export interface PolicyCandidate {
  id: string | number;
  score?: number;
  payload?: {
    content?: string;
    clause_id?: string;
    title?: string;
    category?: string;
    [key: string]: any;
  } | null;
  [key: string]: any;
}

const receiptSchema = {
  type: SchemaType.OBJECT,
  properties: {
    merchant: { type: SchemaType.STRING },
    amount: { type: SchemaType.NUMBER },
    currency: { type: SchemaType.STRING },
    date: { type: SchemaType.STRING },
    category: { type: SchemaType.STRING },
  },
  required: ['merchant', 'amount', 'currency', 'date', 'category'],
};

export async function extractReceiptData(imageBuffer: Buffer, mimeType: string, retries = 3) {
  const models = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview'];

  for (let attempt = 0; attempt < retries; attempt++) {
    const modelName = models[attempt % models.length];
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: receiptSchema as any,
          temperature: 0.0,
        },
        systemInstruction: OCR_SYSTEM_PROMPT,
      });

      const result = await model.generateContent([
        {
          inlineData: {
            data: imageBuffer.toString('base64'),
            mimeType,
          },
        },
        'Extract the receipt data according to the schema.',
      ]);

      return JSON.parse(result.response.text());
    } catch (error: any) {
      if (attempt === retries - 1) throw error;
      console.warn(`[OCR Retry ${attempt + 1}/${retries}] on ${modelName}: ${error.message?.substring(0, 80)}`);
      await delay(2000 * (attempt + 1));
    }
  }
}

export async function runAudit(expenseData: any, policyContext: string, retries = 3) {
  const models = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview'];

  const prompt = `
Policy Context:
"""
${policyContext}
"""

Expense Data:
${JSON.stringify(expenseData, null, 2)}

Audit this expense claim against the policy context provided.
  `;

  for (let attempt = 0; attempt < retries; attempt++) {
    const modelName = models[attempt % models.length];
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.0,
        },
        systemInstruction: AUDIT_PROMPT,
      });

      const result = await model.generateContent(prompt);
      return JSON.parse(result.response.text());
    } catch (error: any) {
      if (attempt === retries - 1) throw error;
      console.warn(`[Audit LLM Retry ${attempt + 1}/${retries}] on ${modelName}: ${error.message?.substring(0, 80)}`);
      await delay(2000 * (attempt + 1));
    }
  }
}

export async function embedText(text: string, retries = 3): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text }] },
        }),
      });

      if (!response.ok) {
        // Fallback to text-embedding-004
        const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
        const fbRes = await fetch(fallbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'models/text-embedding-004',
            content: { parts: [{ text }] },
          }),
        });
        if (!fbRes.ok) throw new Error(`Embedding API error: ${await response.text()}`);
        const fbData = await fbRes.json();
        return fbData.embedding.values;
      }

      const data = await response.json();
      return data.embedding.values;
    } catch (error: any) {
      if (attempt === retries - 1) throw error;
      console.warn(`[Embedding Retry ${attempt + 1}/${retries}]: ${error.message?.substring(0, 80)}`);
      await delay(2000 * (attempt + 1));
    }
  }

  throw new Error('Exhausted embedding retries');
}

/**
 * Two-Stage Cross-Encoder Reranker
 * Scores and reorders retrieved candidate chunks against queryText using joint cross-attention.
 * Safely falls back to top dense candidates with an explicit warning if an error or timeout occurs.
 */
export async function rerankCandidates(
  query: string,
  candidates: PolicyCandidate[],
  topK: number = 3
): Promise<PolicyCandidate[]> {
  if (!candidates || candidates.length === 0) return [];
  if (candidates.length <= topK) return candidates;

  // Prioritize high-throughput, low-latency models for reranking
  const models = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3-flash-preview'];
  const retries = 3;

  try {
    const candidateListText = candidates
      .map((c, idx) => {
        const textSnippet = (c.payload?.content || '').trim().replace(/\s+/g, ' ');
        return `[Candidate ${idx}]: ${textSnippet}`;
      })
      .join('\n\n');

    const rerankPrompt = `You are a cross-encoder ranking model evaluating policy document retrieval.
Analyze how relevant each candidate policy clause is to auditing the specific expense claim query below.
Score each candidate on a continuous relevance scale from 0.000 to 1.000 (1.000 = directly governs this expense claim, 0.000 = completely irrelevant).

Query: "${query}"

Candidates:
${candidateListText}

Return ONLY a raw JSON object with a single key "scores" containing an array of objects for all candidates from index 0 to ${candidates.length - 1}:
{"scores": [{"index": 0, "relevance_score": 0.95}, {"index": 1, "relevance_score": 0.12}, ...]}
Ensure every single candidate index from 0 to ${candidates.length - 1} has an entry with a valid numerical relevance_score between 0.0 and 1.0 without duplicates. Do not include any other keys or markdown fences.`;

    let scoreMap: Map<number, number> | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      const modelName = models[attempt % models.length];
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.0,
          },
        });

        const result = await model.generateContent(rerankPrompt);
        const text = result.response.text();
        const json = JSON.parse(text);

        // 1. Verify Array.isArray(parsedScores)
        if (!Array.isArray(json?.scores)) {
          throw new Error('Response missing "scores" array');
        }

        const currentMap = new Map<number, number>();
        for (const item of json.scores) {
          if (
            typeof item?.index !== 'number' ||
            typeof item?.relevance_score !== 'number' ||
            isNaN(item.relevance_score) ||
            item.relevance_score < 0.0 ||
            item.relevance_score > 1.0
          ) {
            throw new Error(`Invalid score entry at index ${item?.index}: ${item?.relevance_score}`);
          }
          if (currentMap.has(item.index)) {
            throw new Error(`Duplicate score entry for candidate index ${item.index}`);
          }
          currentMap.set(item.index, item.relevance_score);
        }

        // 2. Verify all candidate indices from 0 to candidates.length - 1 are present
        for (let i = 0; i < candidates.length; i++) {
          if (!currentMap.has(i)) {
            throw new Error(`Missing score entry for candidate index ${i}`);
          }
        }

        scoreMap = currentMap;
        break; // Successfully obtained and validated scores
      } catch (err: any) {
        console.warn(
          `[Reranker Attempt ${attempt + 1}/${retries} failed on ${modelName}]: ${err.message?.substring(0, 100)}`
        );
        if (attempt < retries - 1) {
          await delay(1500 * (attempt + 1));
        }
      }
    }

    if (!scoreMap) {
      throw new Error('All reranker retry attempts failed to return valid candidate scores.');
    }

    const scoredCandidates = candidates.map((candidate, idx) => ({
      ...candidate,
      rerank_score: scoreMap!.get(idx) ?? 0.0,
    }));

    // Sort descending by rerank relevance score, tie-breaking by original dense vector score
    scoredCandidates.sort((a, b) => {
      const diff = (b.rerank_score ?? 0) - (a.rerank_score ?? 0);
      if (Math.abs(diff) > 0.001) return diff;
      return (b.score ?? 0) - (a.score ?? 0);
    });

    console.log(`[Two-Stage Retrieval] Reranked ${candidates.length} candidates. Top-${topK} selected.`);
    return scoredCandidates.slice(0, topK);
  } catch (error: any) {
    console.warn(
      `[Two-Stage Retrieval Warning] Cross-encoder reranker failed (${candidates.length} candidates, query: "${query.substring(0, 50)}..."): ${error.message}. Defaulting to top-${topK} vector search.`
    );
    return candidates.slice(0, topK);
  }
}
