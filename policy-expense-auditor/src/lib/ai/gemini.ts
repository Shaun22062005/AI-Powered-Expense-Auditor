import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { OCR_SYSTEM_PROMPT, AUDIT_PROMPT } from './prompts';

const apiKey = process.env.GEMINI_API_KEY!;
const genAI = new GoogleGenerativeAI(apiKey);

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

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
