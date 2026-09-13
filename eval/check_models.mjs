import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '..', '.env.local');

const content = fs.readFileSync(envPath, 'utf8');
let key = '';
content.split('\n').forEach(line => {
  if (line.startsWith('GEMINI_API_KEY=')) {
    key = line.split('=')[1].trim();
  }
});

const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
const data = await res.json();
console.log('Available Models:', data.models?.map(m => m.name.replace('models/', '')));
