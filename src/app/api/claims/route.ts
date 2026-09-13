import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/db/supabase';

export async function GET() {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const query = supabase
    .from('claims')
    .select('*, audit_logs(verdict, confidence_score, reason, policy_excerpt)')
    .order('created_at', { ascending: false });

  if (user) {
    query.eq('employee_id', user.id);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const mappedData = (data || []).map((claim: any) => ({
    ...claim,
    confidence_score: claim.audit_logs?.[0]?.confidence_score || 0,
    reason: claim.audit_logs?.[0]?.reason || null,
    audit_summary: claim.audit_logs?.[0]?.reason || null,
    policy_excerpt: claim.audit_logs?.[0]?.policy_excerpt || null,
  }));

  return NextResponse.json(mappedData);
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    const body = await req.json();
    const { data, error } = await supabase
      .from('claims')
      .insert({ ...body, employee_id: user?.id })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
