import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/db/supabase';
import { z } from 'zod';

const overrideSchema = z.object({
  claim_id: z.string().uuid(),
  new_status: z.string().min(1),
  justification: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = overrideSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Invalid input fields', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const { claim_id, new_status, justification } = validated.data;
    const supabase = createServerClient();

    // 1. Insert into policy_overrides table
    const { data: override, error: overrideError } = await supabase
      .from('policy_overrides')
      .insert({
        claim_id,
        manager_id: '00000000-0000-0000-0000-000000000000',
        new_status,
        justification,
      })
      .select()
      .single();

    if (overrideError) {
      return NextResponse.json({ error: overrideError.message }, { status: 500 });
    }

    // 2. Update the matching claims row status to new_status
    const { data: updated_claim, error: claimError } = await supabase
      .from('claims')
      .update({ status: new_status })
      .eq('id', claim_id)
      .select()
      .single();

    if (claimError) {
      // Note: In a production app, we might want to rollback the override insertion if updating the claim fails.
      // Supabase doesn't support easy transactions via the standard client without using RPC.
      return NextResponse.json({ error: claimError.message }, { status: 500 });
    }

    return NextResponse.json({ override, updated_claim }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
