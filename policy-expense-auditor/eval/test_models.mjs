import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

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

const genAI = new GoogleGenerativeAI(key);

async function testModel(name) {
  try {
    const model = genAI.getGenerativeModel({ model: name });
    const res = await model.generateContent('Say hello in 2 words');
    console.log(`Model ${name} SUCCESS:`, res.response.text().trim());
  } catch (e) {
    console.log(`Model ${name} FAILED:`, e.message.substring(0, 100));
  }
}

await testModel('gemini-3.5-flash');
await testModel('gemini-3.5-flash-lite');
await testModel('gemini-3-flash-preview');
await testModel('gemini-flash-latest');
