# Auditor.ai — RAG Evaluation & Rigor Upgrade
## Project Requirements Document (PRD)

---

## 1. Objective

Upgrade the existing Auditor.ai RAG pipeline (policy-clause retrieval + expense audit decisioning) from a working demo into a project that demonstrates real ML/retrieval engineering rigor: quantified retrieval quality, comparative experimentation, and measurable outcomes.

The existing production pipeline (Gemini OCR → chunking → Qdrant embeddings → top-k retrieval → audit decision) remains untouched in production paths. This PRD establishes an **evaluation and experimentation layer** in `/eval` alongside comparison experiments to produce verifiable, resume-ready metrics.

---

## 2. Core Execution Guardrails & Workflow

To guarantee scientific rigor, prevent synthetic data leakage, and ensure alignment, execution must adhere to three mandatory protocols:

### Guardrail 1: Decoupled Query Generation (Anti-Corpus-Echoing)
When generating the 40 test queries in `eval/dataset.json`:
1. **Independent Employee Scenario Generation:** First, independently write 40 realistic expense justification scenarios from the perspective of an employee submitting an expense claim, without referencing the policy clause wording or section numbers.
2. **Post-Hoc Ground-Truth Mapping:** Only after the scenario is written, map it to the corresponding policy clause(s) (`expected_clause_ids`) and determine the ground-truth outcome (`expected_decision`).
3. **Enforced Difficulty Distribution:**
   - **Easy ($\le$ 10 cases):** Obvious keyword match / straightforward compliance or violation.
   - **Medium ($\ge$ 15 cases):** Requires semantic synonym understanding with zero direct lexical overlap with the policy text.
   - **Hard ($\ge$ 10 cases):** Ambiguous phrasing, multi-clause dependencies, or edge-case expense scenarios.

### Guardrail 2: Explicit Manual Review Checkpoints (No Self-Verification)
- **Checkpoint 1 (Gate 1 - Post-WS1):** After `eval/dataset.json` is generated, **STOP immediately** and present all 40 entries for manual review. No code in WS2 will run until the dataset is approved.
- **Checkpoint 2 (Gate 2 - Post-WS2):** After the retrieval harness runs on baseline data, **STOP immediately** and output the per-query results table along with aggregate metrics (Recall@3, Precision@3, MRR) for the user's explicit review and confirmation before starting WS3.

### Guardrail 3: Strict Sequential Execution
- Execution strictly follows: **WS1** $\rightarrow$ *Gate 1 User Approval* $\rightarrow$ **WS2** $\rightarrow$ *Gate 2 User Approval* $\rightarrow$ **WS3** $\rightarrow$ **WS4** $\rightarrow$ **WS5** $\rightarrow$ **WS6** $\rightarrow$ **WS7** $\rightarrow$ **WS8**.
- No downstream workstream may begin before its predecessor is approved.

---

## 3. Scope & Non-Goals

| In Scope | Out of Scope |
| :--- | :--- |
| Standalone `/eval` test harness and scripts | Modifying production Next.js application routes |
| Isolated Qdrant test collections (`policies_eval_*`) | UI/UX changes |
| 40-case decoupled ground-truth dataset | Fine-tuning foundational LLMs / embedding models |
| Chunking comparison (Fixed 500-char vs. Boundary/Overlap) | Production database schema migrations |
| Reranker comparison (Dense top-k vs. Cross-Encoder rerank) | Modifying live Supabase tables |
| BM25 Lexical retrieval baseline | |
| Decision accuracy & confusion matrix on `rejected` class | |
| Per-stage latency and token cost profiler | |
| Resume-ready summary report ([`eval/REPORT.md`](file:///eval/REPORT.md)) | |

---

## 4. Detailed Workstream Specifications

### WS1 — Ground-Truth Evaluation Dataset
- **Deliverables:** `eval/corporate_policy.md` and `eval/dataset.json`
- **Specification:**
  - 40 test entries covering 6 categories: Travel/Flights, Ground Transport/Mileage, Meals, Alcohol/Entertainment, Lodging, Office Supplies.
  - Schema per entry:
    ```json
    {
      "id": "TC-001",
      "query": "string (employee business justification)",
      "category": "string",
      "claimed_amount": 120.0,
      "currency": "USD",
      "expected_clause_ids": ["§3.2"],
      "expected_decision": "approved" | "flagged" | "rejected",
      "difficulty": "easy" | "medium" | "hard",
      "rationale": "string"
    }
    ```
- **Stop Condition (Gate 1):** Output full dataset to user and wait for explicit confirmation.

---

### WS2 — Retrieval Evaluation Harness
- **Deliverables:** `eval/eval_harness.py` & `eval/results/baseline_retrieval.json`
- **Specification:**
  - Ingest `corporate_policy.md` using production baseline parameters (500-char chunks, `gemini-embedding-001`) into Qdrant collection `policies_eval_baseline`.
  - Evaluate top-3 nearest-neighbor retrieval for all 40 queries.
  - Compute & log:
    - **Recall@3:** $\frac{|\text{Retrieved} \cap \text{Expected}|}{|\text{Expected}|}$
    - **Precision@3:** $\frac{|\text{Retrieved} \cap \text{Expected}|}{3}$
    - **MRR (Mean Reciprocal Rank):** $\frac{1}{\text{rank of first relevant clause}}$
- **Stop Condition (Gate 2):** Output full per-query results table and aggregate metrics to user and wait for explicit confirmation before starting WS3.

---

### WS3 — Chunking Strategy Comparison
- **Deliverables:** `eval/chunking_experiment.py` & `eval/results/chunking_comparison.json`
- **Specification:**
  - **Baseline:** Fixed 500-character chunks with no boundary awareness.
  - **Challenger:** Header & clause-boundary aware chunking with 100-character context overlap.
  - Evaluate on the identical 40-query dataset in `policies_eval_boundary`.
  - Report side-by-side metrics table ($\Delta\text{Recall@3}, \Delta\text{Precision@3}, \Delta\text{MRR}$) + written conclusion.

---

### WS4 — Embedding vs. Cross-Encoder Reranker Comparison
- **Deliverables:** `eval/reranker_experiment.py` & `eval/results/reranker_comparison.json`
- **Specification:**
  - **Pipeline A:** Direct top-3 retrieval from dense vector search.
  - **Pipeline B:** Top-10 initial retrieval $\rightarrow$ local Cross-Encoder (`ms-marco-MiniLM-L-6-v2`) $\rightarrow$ rerank to top-3.
  - Measure precision lift and rank improvement on multi-clause / hard queries.

---

### WS5 — Lexical Baseline (BM25)
- **Deliverables:** `eval/baseline_bm25.py` & `eval/results/bm25_comparison.json`
- **Specification:**
  - Implement BM25 lexical ranking (`rank-bm25`) over the chunked policy corpus.
  - Evaluate on the 40 test queries.
  - Produce dense vs. sparse comparative analysis: quantify whether embedding retrieval justifies computational complexity.

---

### WS6 — End-to-End Decision Accuracy
- **Deliverables:** `eval/decision_accuracy.py` & `eval/results/decision_accuracy.json`
- **Specification:**
  - Feed retrieved policy context + claim data to Gemini 2.5 Flash using production audit prompt.
  - Compute overall accuracy, classification report, and **Confusion Matrix**.
  - Specifically measure **Precision & Recall on the `rejected` class** to evaluate compliance leak risk (false approvals).

---

### WS7 — Cost & Latency Instrumentation
- **Deliverables:** `eval/cost_latency_profiler.py` & `eval/results/cost_latency.json`
- **Specification:**
  - Measure exact wall-clock latency (ms) and token counts across:
    1. Query embedding generation
    2. Vector retrieval & Reranking
    3. LLM audit judgment generation
  - Profile cost per 1,000 audits based on Gemini API pricing tiers.

---

### WS8 — Consolidated Report & Resume Bullets
- **Deliverables:** `eval/REPORT.md`
- **Specification:**
  - Single consolidated executive markdown report with complete data tables across WS2–WS7.
  - Key architectural takeaways and failure mode analysis.
  - 3 candidate resume bullet phrasings with real quantified metrics.

---

## 5. Deliverables & File Structure

```
policy-expense-auditor/
└── eval/
    ├── PRD.md                                 # Requirements Document
    ├── corporate_policy.md                    # Ground-truth corporate policy corpus
    ├── dataset.json                           # 40 decoupled test cases (easy/medium/hard)
    ├── eval_harness.py                        # WS2: Base retrieval evaluation engine
    ├── chunking_experiment.py                 # WS3: Fixed vs. boundary chunking benchmark
    ├── reranker_experiment.py                 # WS4: Vector vs. Cross-encoder reranking
    ├── baseline_bm25.py                       # WS5: Lexical BM25 baseline
    ├── decision_accuracy.py                   # WS6: End-to-end decision evaluation
    ├── cost_latency_profiler.py               # WS7: Latency & cost breakdown
    ├── REPORT.md                              # WS8: Consolidated report & resume bullets
    └── results/                               # Generated JSON benchmark logs
        ├── baseline_retrieval.json
        ├── chunking_comparison.json
        ├── reranker_comparison.json
        ├── bm25_comparison.json
        ├── decision_accuracy.json
        └── cost_latency.json
```

---

## 6. Definition of Done

1. All 8 workstreams completed sequentially with user checkpoint approvals at Gate 1 and Gate 2.
2. 40-case dataset strictly generated decoupled from policy wording with $\le 10$ easy, $\ge 15$ medium, and $\ge 10$ hard queries.
3. Production code and collections left completely untouched.
4. `eval/REPORT.md` populated with real, reproducible numbers (zero placeholders).
