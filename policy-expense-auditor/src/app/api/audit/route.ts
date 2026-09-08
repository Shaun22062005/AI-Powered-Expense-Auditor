import { NextRequest, NextResponse } from 'next/server';
import { extractReceiptData, runAudit, embedText, rerankCandidates, PolicyCandidate } from '@/lib/ai/gemini';
import { qdrant } from '@/lib/qdrant/client';
import { createServerClient } from '@/lib/db/supabase';
import { sendAuditNotification } from '@/lib/email/resend';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('receipt') as File;
    if (!file) return NextResponse.json({ error: 'No receipt provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());

    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    const fileName = `${Date.now()}-${file.name.replace(/\s/g, '_')}`;
    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from('receipts')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: true
      });

    if (uploadError) throw new Error(`Failed to upload receipt: ${uploadError.message}`);
    const receiptStoragePath = uploadData.path;

    const extractedData = await extractReceiptData(buffer, file.type);
    console.log('Extracted Data:', JSON.stringify(extractedData, null, 2));

    const manualData = {
      merchant: formData.get('merchant') as string,
      amount: formData.get('amount') as string,
      currency: formData.get('currency') as string,
      category: formData.get('category') as string,
      expense_date: formData.get('expense_date') as string,
      business_purpose: formData.get('business_purpose') as string,
    };

    const { data: claim, error: claimError } = await supabase
      .from('claims')
      .insert({
        merchant: manualData.merchant || extractedData.merchant,
        amount: parseFloat(manualData.amount || extractedData.amount),
        currency: manualData.currency || extractedData.currency,
        category: manualData.category || extractedData.category,
        expense_date: manualData.expense_date || extractedData.expense_date,
        business_purpose: manualData.business_purpose || '',
        receipt_storage_path: receiptStoragePath,
        status: 'auditing'
      })
      .select()
      .single();

    if (claimError) throw new Error(`Claim insertion failed: ${claimError.message}`);

    // Construct rich semantic query incorporating category, merchant, business purpose, and amount
    const queryParts = [
      manualData.category || extractedData.category,
      manualData.merchant || extractedData.merchant ? `at ${manualData.merchant || extractedData.merchant}` : '',
      manualData.business_purpose ? `Purpose: ${manualData.business_purpose}` : '',
      manualData.amount || extractedData.amount ? `Amount: ${manualData.amount || extractedData.amount} ${manualData.currency || extractedData.currency || 'USD'}` : ''
    ].filter(Boolean);
    const queryText = queryParts.join(' | ');

    const embedding = await embedText(queryText);

    // Stage 1: Candidate Retrieval from Qdrant (broad pool: top 10 candidates)
    const initialCandidates = await qdrant.search('policies', {
      vector: embedding,
      limit: 10,
    });
    console.log(`[Two-Stage Retrieval] Qdrant retrieved ${initialCandidates.length} candidate chunks for query: "${queryText}"`);

    // Stage 2: Cross-Encoder Reranking (scores candidates against queryText; falls back safely to dense top-3 if needed)
    const topChunks = await rerankCandidates(queryText, initialCandidates as PolicyCandidate[], 3);
    console.log(
      '[Two-Stage Retrieval] Selected Top-3 Chunks:',
      JSON.stringify(
        topChunks.map((c) => ({
          id: c.id,
          clause_id: c.payload?.clause_id,
          title: c.payload?.title,
          dense_score: c.score,
          rerank_score: c.rerank_score,
        })),
        null,
        2
      )
    );

    // Build policy context strictly from the top-3 reranked chunks
    const policyContext = topChunks.map(r => r.payload?.content).filter(Boolean).join('\n\n---\n\n');
    const combinedData = {
      receipt: extractedData,
      user_claim: manualData
    };

    let verdict;
    let auditLog;

    try {
      verdict = await runAudit(combinedData, policyContext);
      console.log('Verdict from AI:', JSON.stringify(verdict));

      // Normalize verdict status
      const finalVerdict = verdict.status === 'compliant' ? 'approved' : verdict.status;
      
      // Normalize confidence score to 0-100 integer
      let finalScore = verdict.confidence_score;
      if (finalScore <= 1.0) {
        finalScore = Math.round(finalScore * 100);
      }

      const { data: logData, error: logError } = await supabase.from('audit_logs').insert({ 
        claim_id: claim.id, 
        verdict: finalVerdict, 
        reason: verdict.reason, 
        policy_excerpt: verdict.policy_excerpt, 
        confidence_score: finalScore, 
        raw_ai_response: verdict 
      }).select().single();

      if (logError) throw new Error(`Audit log insertion failed: ${logError.message}`);
      auditLog = logData;

      // Update claim status with normalized verdict
      const { error: updateError } = await supabase
        .from('claims')
        .update({ status: finalVerdict })
        .eq('id', claim.id);

      if (updateError) throw new Error(`Claim status update failed: ${updateError.message}`);
    } catch (auditError) {
      console.error('Audit processing failed:', auditError);
      throw auditError;
    }

    try {
      await sendAuditNotification({
        to: "test@example.com",
        employeeName: "Employee",
        merchant: manualData.merchant || extractedData.merchant,
        amount: parseFloat(manualData.amount || extractedData.amount),
        currency: manualData.currency || extractedData.currency,
        status: verdict.status,
        reason: verdict.reason,
      });
    } catch (emailError) {
      console.error('Email notification failed:', emailError);
    }

    return NextResponse.json({
      claim,
      audit: auditLog
    });
  } catch (error) {
    console.error('Full error:', JSON.stringify(error, null, 2));
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
