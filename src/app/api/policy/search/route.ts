import { NextRequest, NextResponse } from 'next/server';
import { qdrant } from '@/lib/qdrant/client';
import { embedText } from '@/lib/ai/gemini';

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get('query');
    if (!query) return NextResponse.json({ error: 'No query provided' }, { status: 400 });

    const vector = await embedText(query);
    
    const searchResult = await qdrant.search('policies', {
      vector,
      limit: 4,
      with_payload: true,
    });

    return NextResponse.json({
      success: true,
      query,
      results: searchResult.map((hit) => ({
        content: hit.payload?.content,
        score: hit.score,
        metadata: {
          filename: hit.payload?.filename,
        },
      })),
    });
  } catch (error: any) {
    console.error('Policy Search Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
