# Corporate Policy based Expense Auditor (Auditor.ai)

> An AI-native corporate expense audit system that automatically verifies employee receipt submissions against company Travel & Expense (T&E) policy documents using Multimodal Vision AI and Vector RAG search.

---

## 🎯 What It Is & Primary Use Case

The **Policy-First Expense Auditor** is an end-to-end automated platform that processes corporate expense claims instantly. 

When an employee submits a receipt and business justification:
1. **Multimodal OCR**: Google Gemini 1.5 Flash extracts receipt metadata (merchant, total amount, currency, date, readability score) directly from receipt images.
2. **Policy RAG Search**: The claim category and stated business purpose are embedded via `text-embedding-004` and cross-referenced against vectorized company policy clauses stored in **Qdrant**.
3. **Structured AI Audit Verdict**: Gemini evaluates the claim against the retrieved policy clauses and generates a strict, structured verdict (`Approved`, `Flagged`, or `Rejected`) containing:
   - **Verdict Status**: `Approved` | `Flagged` | `Rejected`
   - **Reason**: Exactly one concise sentence explaining the decision.
   - **Policy Excerpt**: The exact matching clause from the company policy.
   - **Confidence Score**: A 0.0 to 1.0 risk score.
4. **Manager Overrides**: Flagged or rejected claims can be reviewed by managers with human-in-the-loop overrides and recorded audit trails.

---

## 🔄 What It Replaces

Traditional corporate expense auditing is flawed, slow, and expensive. This platform replaces:

* **Manual Finance Team Review**: Eliminates line-by-line manual receipt checking by finance teams, reducing review cycles from **weeks to seconds**.
* **Static Spreadsheets & Hardcoded Rules**: Replaces rigid, static spending limit spreadsheets with contextual policy checking (e.g., checking if a meal receipt complies with client entertainment guidelines).
* **High Fraud & Human Error Rates**: Eliminates human oversight fatigue, missing receipt details, or inconsistent policy enforcement across departments.
* **Delayed Employee Reimbursements**: Prevents cash-flow friction for employees by providing immediate feedback on claim eligibility upon upload.
* **Disconnected Email Threads**: Replaces fragmented back-and-forth emails between finance, managers, and employees with centralized audit logs and Resend email alerts.

---

## 🛠️ Tech Stack

* **Frontend**: Next.js 14 (App Router), React 18, Tailwind CSS, shadcn/ui, Lucide Icons
* **Backend**: Next.js API Routes (TypeScript)
* **Database & File Storage**: Supabase (PostgreSQL + Supabase Storage for receipt images & PDFs)
* **AI & Vision Engine**: `@google/generative-ai` (Gemini 1.5 Flash for multimodal OCR & structured JSON audit reasoning)
* **Vector DB (RAG)**: Qdrant (`@qdrant/js-client-rest`) with Google `text-embedding-004` (768-dim embeddings)
* **Transactional Email**: Resend
* **Validation**: Zod schema validation for strict API boundaries

---

## 🗄️ Database Schema

The database relies on four primary PostgreSQL tables in Supabase:

* `employees`: Stores user profiles, departments, roles (`employee`, `manager`, `admin`), and manager relationships.
* `claims`: Stores claim metadata, amounts, currency, business purpose, receipt storage paths, and current status (`pending`, `auditing`, `approved`, `flagged`, `rejected`). Auto-updates `updated_at` via database trigger.
* `audit_logs`: Stores the AI verdict, confidence score, 1-sentence reason, policy clause excerpt, and raw AI response.
* `policy_overrides`: Records human manager overrides with justification for audit compliance.

---

## 🚀 How to Setup & Use

### Prerequisites
* **Node.js**: v18.0.0 or higher
* **Supabase Account**: Project URL & Anon Key + Storage bucket named `receipts`
* **Qdrant Vector DB**: Cluster URL & API Key
* **Google Gemini API Key**: API key with access to `gemini-1.5-flash` and `text-embedding-004`
* **Resend API Key**: For sending email notifications

---

### Step 1: Clone the Repository & Install Dependencies

```bash
git clone https://github.com/Shaun22062005/cymonic_project.git
cd cymonic_project/policy-expense-auditor
npm install
```

---

### Step 2: Configure Environment Variables

Create a `.env.local` file in `policy-expense-auditor/` with the following variables:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-supabase-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key

# Qdrant Vector DB
QDRANT_URL=https://your-qdrant-cluster-url.qdrant.tech
QDRANT_API_KEY=your-qdrant-api-key

# Google Gemini AI Key
GEMINI_API_KEY=your-google-gemini-api-key

# Resend Email Key
RESEND_API_KEY=re_your_resend_key
```

---

### Step 3: Run Database Migrations

Execute the SQL script in your Supabase SQL Editor to create the enum, tables, indexes, and auto-update triggers:

```sql
-- Trigger function for auto-updating updated_at columns
CREATE OR REPLACE FUNCTION set_current_timestamp_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Employees / Users
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    department VARCHAR(100),
    role VARCHAR(50) DEFAULT 'employee',
    manager_id UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_employees_updated_at
BEFORE UPDATE ON employees
FOR EACH ROW
EXECUTE FUNCTION set_current_timestamp_updated_at();

-- Expense Claims
CREATE TYPE claim_status AS ENUM ('pending', 'auditing', 'approved', 'flagged', 'rejected');

CREATE TABLE claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    merchant VARCHAR(255) NOT NULL,
    expense_date DATE NOT NULL,
    business_purpose TEXT NOT NULL,
    category VARCHAR(100),
    receipt_storage_path TEXT NOT NULL,
    status claim_status DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_claims_updated_at
BEFORE UPDATE ON claims
FOR EACH ROW
EXECUTE FUNCTION set_current_timestamp_updated_at();

-- AI Audit Logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID REFERENCES claims(id) ON DELETE CASCADE NOT NULL,
    verdict claim_status NOT NULL,
    confidence_score FLOAT CHECK (confidence_score >= 0 AND confidence_score <= 1),
    reason TEXT NOT NULL,
    policy_excerpt TEXT NOT NULL,
    raw_ai_response JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Manager Policy Overrides
CREATE TABLE policy_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID REFERENCES claims(id) ON DELETE CASCADE NOT NULL,
    manager_id UUID REFERENCES employees(id) NOT NULL,
    new_status claim_status NOT NULL,
    justification TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX idx_claims_employee_id ON claims(employee_id);
CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_audit_logs_claim_id ON audit_logs(claim_id);
```

Ensure a storage bucket named `receipts` is set up in Supabase Storage with public/authenticated read access as appropriate.

---

### Step 4: Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### Step 5: How to Submit a Claim & Perform Audits

#### 1. Uploading & Submitting a Claim (API)
Send a `POST` request to `/api/audit` using `multipart/form-data`:

```bash
curl -X POST http://localhost:3000/api/audit \
  -F "receipt=@/path/to/receipt.jpeg" \
  -F "employee_id=YOUR_EMPLOYEE_UUID" \
  -F "merchant=Uber" \
  -F "amount=45.50" \
  -F "currency=USD" \
  -F "category=Travel" \
  -F "expense_date=2026-03-28" \
  -F "business_purpose=Taxi ride from airport to client meeting location"
```

#### 2. Response Payload Example
```json
{
  "claim": {
    "id": "c7a840e2-892b-4786-a212-68fb4f1a2384",
    "employee_id": "YOUR_EMPLOYEE_UUID",
    "amount": 45.5,
    "currency": "USD",
    "merchant": "Uber",
    "expense_date": "2026-03-28",
    "business_purpose": "Taxi ride from airport to client meeting location",
    "category": "Travel",
    "receipt_storage_path": "YOUR_EMPLOYEE_UUID-1711652400-receipt.jpeg",
    "status": "approved",
    "created_at": "2026-03-28T20:45:00.000Z",
    "updated_at": "2026-03-28T20:45:01.000Z"
  },
  "audit": {
    "id": "e4f51a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
    "claim_id": "c7a840e2-892b-4786-a212-68fb4f1a2384",
    "verdict": "approved",
    "confidence_score": 0.95,
    "reason": "Ground transportation for business travel under $50 is approved without prior manager pre-approval.",
    "policy_excerpt": "Section 4.2 (Ground Transportation): Taxis, rideshares, and public transit under $50 per trip incurred during business travel are fully reimbursable.",
    "created_at": "2026-03-28T20:45:01.000Z"
  }
}
```

#### 3. Viewing Claims & Audit Dashboard
Send a `GET` request to `/api/claims` to view all submitted claims and their latest audit log, sorted by lowest confidence score (highest compliance risk first).
