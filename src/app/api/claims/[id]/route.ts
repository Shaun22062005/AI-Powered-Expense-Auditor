import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/db/supabase';
import { z } from 'zod';

const patchSchema = z.object({
  status: z.string().min(1),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const supabase = createServerClient();

    // Fetch claim joined with audit_logs and policy_overrides
    const { data, error } = await supabase
      .from('claims')
      .select('*, audit_logs(*), policy_overrides(*)')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await req.json();
    
    const validated = patchSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const { status } = validated.data;
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('claims')
      .update({ status })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
