import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'baseline_retrieval.json'), 'utf8'));

console.log('| ID | Diff | Expected Clauses | Top-3 Retrieved Clauses | Matched Hits | Recall@3 | Prec@3 | MRR | Result |');
console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

data.queries.forEach(q => {
  const exp = q.expected_clause_ids.join(', ');
  const ret = q.retrieved_clauses.join(', ');
  const hits = q.hit_clauses.join(', ') || 'None';
  const rec = (q.recall_at_3 * 100).toFixed(0) + '%';
  const prec = (q.precision_at_3 * 100).toFixed(0) + '%';
  const mrr = q.mrr.toFixed(2);
  const status = q.full_pass ? '✅ Full' : (q.passed ? '⚠️ Partial' : '❌ Miss');
  console.log(`| **${q.id}** | \`${q.difficulty}\` | \`${exp}\` | \`${ret}\` | \`${hits}\` | ${rec} | ${prec} | ${mrr} | ${status} |`);
});
