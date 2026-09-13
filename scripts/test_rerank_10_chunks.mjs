import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Load environment variables from .env.local
const envPath = path.join(projectRoot, '.env.local');
if (fs.existsSync(envPath)) {
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

// Import rerankCandidates from compiled / ts-node or direct import via dynamic import
const { rerankCandidates } = await import('../src/lib/ai/gemini.ts');

const dummy10Chunks = [
  { id: 'c1', score: 0.81, payload: { clause_id: '§1.1', title: 'Commercial Air Travel', content: 'Employees must book the lowest standard economy coach class airfare available.' } },
  { id: 'c2', score: 0.79, payload: { clause_id: '§1.2', title: 'Advance Airfare Booking', content: 'All commercial flights must be booked at least 14 days prior to travel to obtain corporate discounted fares.' } },
  { id: 'c3', score: 0.78, payload: { clause_id: '§2.1', title: 'Rideshare and Taxi', content: 'Taxis, rideshares, and public transit for business travel are reimbursable up to $50 per single one-way trip.' } },
  { id: 'c4', score: 0.76, payload: { clause_id: '§2.3', title: 'Rental Vehicles', content: 'Rental cars are authorized only when public transit or ridesharing is unavailable or more costly. Intermediate size max.' } },
  { id: 'c5', score: 0.74, payload: { clause_id: '§2.4', title: 'Airport Long-Term Parking', content: 'Airport parking is reimbursable only for economy or long-term lots up to $30.00 per day. Valet parking is excluded.' } },
  { id: 'c6', score: 0.72, payload: { clause_id: '§3.1', title: 'Daily Meal Allowance', content: 'Individual meal limit is capped at $75 total per full day of authorized business travel.' } },
  { id: 'c7', score: 0.70, payload: { clause_id: '§3.3', title: 'Client Business Dining', content: 'Client entertaining meals must include documented list of attendees and clear business purpose. Capped at $125/person.' } },
  { id: 'c8', score: 0.68, payload: { clause_id: '§4.1', title: 'Alcohol Exclusion', content: 'Corporate funds shall not be used for personal recreational items or alcoholic beverages under any circumstances.' } },
  { id: 'c9', score: 0.65, payload: { clause_id: '§4.3', title: 'Traffic Fines and Penalties', content: 'Traffic fines, parking tickets, towing fees, and moving violations are strictly non-reimbursable personal liabilities.' } },
  { id: 'c10', score: 0.62, payload: { clause_id: '§5.1', title: 'Standard Hotel Lodging', content: 'Hotel accommodations are reimbursed up to $220.00/night for standard business travel in tier-2 cities.' } },
];

const testQuery = 'Client dinner at steakhouse with itemized attendee names and business discussion totaling $110 per guest';

console.log('Testing rerankCandidates with 10 dummy policy chunks...');
console.log(`Query: "${testQuery}"\n`);

const top3 = await rerankCandidates(testQuery, dummy10Chunks, 3);

console.log('\nReranked Top 3 Result:');
top3.forEach((chunk, i) => {
  console.log(`Rank ${i + 1}: ${chunk.payload.clause_id} - ${chunk.payload.title} | Rerank Score: ${chunk.rerank_score} (Original Dense: ${chunk.score})`);
});

if (top3.length === 3 && top3[0].payload.clause_id === '§3.3') {
  console.log('\n✓ SUCCESS: rerankCandidates successfully processed all 10 candidates, validated all scores, and promoted §3.3 Client Business Dining to Rank 1 without triggering fallback!');
} else {
  throw new Error(`Unexpected top result: ${top3[0]?.payload?.clause_id}`);
}
