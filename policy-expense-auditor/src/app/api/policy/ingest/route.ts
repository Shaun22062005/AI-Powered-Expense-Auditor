import { NextRequest, NextResponse } from 'next/server';
import pdf from 'pdf-parse';
import { qdrant, ensureCollection } from '@/lib/qdrant/client';
import { embedText } from '@/lib/ai/gemini';

// Structural, section-aware chunking preserving headings and clause boundaries
function createBoundaryAwareChunks(text: string): { content: string; title?: string; clauseId?: string }[] {
  const lines = text.split('\n');
  let currentCategory = '';
  let currentClauseId = '';
  let currentClauseTitle = '';
  let currentContentLines: string[] = [];
  const chunks: { content: string; title?: string; clauseId?: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect Category headers (e.g. "## 1. Travel" or "SECTION 1:")
    if ((line.startsWith('## ') || line.match(/^[0-9]+\.\s+[A-Z]/)) && !line.startsWith('### ')) {
      currentCategory = line.replace(/^[#\s0-9.]+/g, '').trim();
    } 
    // Detect Clause headers (e.g. "### §1.1 Economy Class" or "1.1 Economy Class" or "Section 1.1")
    else if (line.startsWith('### ') || line.match(/^(?:§|Section\s+)?([0-9]+\.[0-9]+)\s+(.+)/i)) {
      if (currentClauseId && currentContentLines.length > 0) {
        const fullClauseText = [
          currentCategory ? `Category: ${currentCategory}` : '',
          `Clause: ${currentClauseId} - ${currentClauseTitle}`,
          '',
          currentContentLines.join('\n').trim()
        ].filter(Boolean).join('\n');

        chunks.push({
          content: fullClauseText,
          title: currentClauseTitle,
          clauseId: currentClauseId
        });
      }

      const match = line.match(/(?:###\s+)?(?:§|Section\s+)?([0-9]+\.[0-9]+)\s*[:-]?\s*(.+)/i);
      if (match) {
        currentClauseId = match[1].trim();
        currentClauseTitle = match[2].trim();
        currentContentLines = [];
      } else {
        currentClauseId = `§${chunks.length + 1}`;
        currentClauseTitle = line.replace(/^[#\s]+/g, '').trim();
        currentContentLines = [];
      }
    } else {
      if (line.trim()) {
        currentContentLines.push(line);
      }
    }
  }

  // Flush trailing clause
  if (currentContentLines.length > 0) {
    const fullClauseText = [
      currentCategory ? `Category: ${currentCategory}` : '',
      currentClauseId ? `Clause: ${currentClauseId} - ${currentClauseTitle}` : '',
      '',
      currentContentLines.join('\n').trim()
    ].filter(Boolean).join('\n');

    chunks.push({
      content: fullClauseText,
      title: currentClauseTitle,
      clauseId: currentClauseId
    });
  }

  // Fallback if document had no clear section headers: chunk by paragraphs (~600 chars)
  if (chunks.length <= 1 && text.length > 800) {
    const fallbackChunks: { content: string }[] = [];
    const paragraphs = text.split(/\n\s*\n/);
    let buffer = '';

    for (const p of paragraphs) {
      if ((buffer + '\n\n' + p).length > 600 && buffer.trim()) {
        fallbackChunks.push({ content: buffer.trim() });
        buffer = p;
      } else {
        buffer = buffer ? `${buffer}\n\n${p}` : p;
      }
    }
    if (buffer.trim()) fallbackChunks.push({ content: buffer.trim() });
    return fallbackChunks;
  }

  return chunks;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('policy') as File;
    if (!file) return NextResponse.json({ error: 'No policy file provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    let text = '';

    if (file.name.endsWith('.pdf')) {
      const data = await pdf(buffer);
      text = data.text;
    } else {
      text = buffer.toString('utf8');
    }

    // Apply structural boundary-aware chunking
    const chunks = createBoundaryAwareChunks(text);

    await ensureCollection('policies');

    const points = await Promise.all(
      chunks.map(async (chunk, idx) => {
        const vector = await embedText(chunk.content);
        return {
          id: crypto.randomUUID(),
          vector,
          payload: {
            chunk_index: idx + 1,
            clause_id: chunk.clauseId || `chunk-${idx + 1}`,
            title: chunk.title || '',
            content: chunk.content,
            filename: file.name,
            created_at: new Date().toISOString(),
          },
        };
      })
    );

    await qdrant.upsert('policies', {
      wait: true,
      points,
    });

    return NextResponse.json({ success: true, chunkCount: chunks.length });
  } catch (error: any) {
    console.error('Policy Ingestion Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
