# DEPLOYMENT.md — Zero-additional-cash GCP deployment

**Every command in this file is run by the owner, or by Claude Code only after the owner explicitly approves that specific command.** Nothing here is automatic.

## 1. Billing facts and residual risk

VERIFIED (Google Cloud docs, Oct 27, 2026):
- The Free Trial gives $300 of credit valid for 90 days. During the trial, after the one-time card verification, no charges are made unless you **upgrade to a paid billing account**.
- The trial ends when the credit is spent or 90 days pass. If you have not upgraded, the trial billing account closes and its projects/resources stop; there is a 30-day grace period before deletion.
- Always Free usage within limits is not charged against the trial credit.
- Upgrading ends the trial; afterwards you are billed for usage beyond remaining credit and free tier.

Owner facts: trial started **Oct 25, 2026** → expected end about **Jan 23, 2027**. **[OWNER] verify** the exact end date and remaining credit on **Billing → Overview** before deploying, and weekly after.

Rules:
1. **Never upgrade the billing account.** This is the main protection for $0 out-of-pocket.
2. If the trial ends early (credit exhausted), the demo stops; the README's local setup remains the fallback demo path (rules allow run instructions instead of a hosted URL).
3. Residual risk: Google states trial access to some products may be limited to prevent abuse; if Vertex AI is restricted for the trial account, T-007 will reveal it. Budget alerts do not cap spend; on a trial account the trial itself is the hard stop.

## 2. Services and cost

| Service | Why | Free tier (verify on the pricing page) | Trial credit eligible | Expected use | Est. cost |
| --- | --- | --- | --- | --- | --- |
| Cloud Run | Hosts the app + webhook endpoint | Monthly always-free request/CPU/memory allowance (2M requests) | Yes | < 10k requests | $0 |
| Firestore (Native) | App data | 1 GiB storage; daily read/write/delete quotas (50K/20K/20K) on one database per project | Yes | < 2k ops/day | $0 |
| Cloud Storage | Photos, AI raw responses | 5 GB Standard in us-central1/us-east1/us-west1 | Yes | < 1 GB | $0 |
| Vertex AI (Gemini) | Inspection; eval image generation | None | Expected yes (verify in T-007) | ~500 inspections + ≤ 60 image edits | ~$5–20 of credit (estimate) |
| Cloud Build | Builds for `run deploy --source` | Daily free build minutes | Yes | ~20 builds | $0 |
| Artifact Registry | Container images | 0.5 GB free | Yes | Keep ≤ 3 images | $0–cents |
| Secret Manager | Secrets | Small free allowance (verify) | Yes | ~7 secrets | ~$0 |
| Cloud Logging | Logs | Free monthly ingestion allowance (verify) | Yes | small | $0 |

Not used (would cost money or add risk): load balancers, custom domains, Cloud SQL, GPUs, Firebase paid plans, min-instances > 0.

## 3. Project setup [OWNER]

```bash
gcloud auth login
gcloud config set project <PROJECT_ID>
gcloud config set run/region us-central1
gcloud billing projects describe <PROJECT_ID>       # confirm linked to the Free Trial billing account
gcloud services enable run.googleapis.com firestore.googleapis.com storage.googleapis.com \
  aiplatform.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
gcloud auth application-default login                 # local dev credentials for Firestore/GCS/Vertex
```
Enable APIs incrementally if preferred: `aiplatform` is needed for T-007; Firestore/Storage for T-015/T-030; the rest at deployment.

## 4. Firestore and Storage [OWNER]

```bash
gcloud firestore databases create --location=us-central1 --type=firestore-native
gcloud storage buckets create gs://<BUCKET> --location=us-central1 \
  --uniform-bucket-level-access --public-access-prevention
cat > lifecycle.json <<'EOF'
{ "rule": [ { "action": { "type": "Delete" }, "condition": { "age": 120 } } ] }
EOF
gcloud storage buckets update gs://<BUCKET> --lifecycle-file=lifecycle.json
```
Local dev uses `FIRESTORE_COLLECTION_PREFIX=dev_` so dev data never mixes with demo data. Create the composite index when Firestore's error message links to it (rentals by `status`, `updatedAt desc`).

## 5. Service account, IAM, secrets [OWNER]

```bash
gcloud iam service-accounts create holdfast-run --display-name="Holdfast Cloud Run"
SA=holdfast-run@<PROJECT_ID>.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding <PROJECT_ID> --member=serviceAccount:$SA --role=roles/datastore.user
gcloud projects add-iam-policy-binding <PROJECT_ID> --member=serviceAccount:$SA --role=roles/aiplatform.user
gcloud storage buckets add-iam-policy-binding gs://<BUCKET> --member=serviceAccount:$SA --role=roles/storage.objectAdmin
# Needed so the service can sign V4 URLs via IAM signBlob (no key file):
gcloud iam service-accounts add-iam-policy-binding $SA --member=serviceAccount:$SA --role=roles/iam.serviceAccountTokenCreator

for S in PAYPAL_CLIENT_SECRET PAYPAL_WEBHOOK_ID STAFF_PASSCODE SESSION_SECRET RENTER_LINK_SECRET; do
  printf '%s' "<value>" | gcloud secrets create $S --data-file=-      # replace <value> per secret
  gcloud secrets add-iam-policy-binding $S --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
done
```
Generate random secrets with `openssl rand -base64 48`. Never commit them; never paste them into chat.

## 6. Cloud Run deployment (T-070; approval required)

Pre-deploy checklist: `npm run typecheck && npm run lint && npm test && npm run build && npx tsx scripts/check-bundle-secrets.ts` all pass.

```bash
gcloud run deploy holdfast --source . --region us-central1 \
  --service-account $SA --allow-unauthenticated \
  --min-instances 0 --max-instances 2 --cpu 1 --memory 1Gi --concurrency 20 --timeout 120 \
  --set-env-vars PAYPAL_ENV=sandbox,PAYPAL_CLIENT_ID=<id>,NEXT_PUBLIC_PAYPAL_CLIENT_ID=<id>,SETTLEMENT_MODE=<mode>,GCP_PROJECT_ID=<PROJECT_ID>,GCP_REGION=us-central1,GCS_BUCKET=<BUCKET>,VERTEX_LOCATION=<loc>,GEMINI_MODEL=<model>,AI_MODE=live,AI_DAILY_CALL_LIMIT=300,FIRESTORE_COLLECTION_PREFIX=,DEMO_BANNER=true,APP_BASE_URL=<set after first deploy> \
  --set-secrets PAYPAL_CLIENT_SECRET=PAYPAL_CLIENT_SECRET:latest,PAYPAL_WEBHOOK_ID=PAYPAL_WEBHOOK_ID:latest,STAFF_PASSCODE=STAFF_PASSCODE:latest,SESSION_SECRET=SESSION_SECRET:latest,RENTER_LINK_SECRET=RENTER_LINK_SECRET:latest
```
Notes:
- `NEXT_PUBLIC_*` values are inlined at **build** time; the Dockerfile must accept them as build args (or use the source deploy's build env). T-070 documents the exact approach.
- After the first deploy, set `APP_BASE_URL` to the `*.run.app` URL and redeploy (`gcloud run services update holdfast --update-env-vars APP_BASE_URL=...`).
- Image cleanup: add a cleanup policy on the `cloud-run-source-deploy` Artifact Registry repository keeping the 3 most recent versions (configure in console: Artifact Registry → repository → Cleanup policies), or delete old images manually after each deploy.

## 7. Monitoring and cost alerts [OWNER]

1. **Budget:** Billing → Budgets & alerts → create budget "holdfast", amount $300, scope the project, thresholds at 2%, 5%, 10%, 25%, 50% (actual spend), email the owner. In the budget's credit settings, choose to **exclude credits** so alerts track gross usage (on a trial, net cost is $0, so alerts that include credits never fire). Verify the option name in the console.
2. **Weekly check (every Monday):** Billing → Reports grouped by SKU; Billing → Overview (credit remaining, trial end date).
3. **Vertex usage:** the app's `meta/aiUsage_<date>` counter; Vertex AI → Dashboard request counts.
4. **Cloud Run:** Metrics tab (requests, instance count). Max instances 2 is a hard ceiling.

## 8. Quota and abuse controls

- `AI_DAILY_CALL_LIMIT=300` enforced in app; eval scripts have `--max-calls`.
- Image generation cap: 60 per run, documented in T-051.
- Staff login rate limit; renter links are rental-scoped.
- Upload limit 10 MB, image types only.
- Optional during judging: lower `AI_DAILY_CALL_LIMIT` to 150.

## 9. Smoke test after deploy [OWNER]

1. Open the URL; sandbox banner visible.
2. Book an item with the sandbox buyer → rental `AUTHORIZED`.
3. Webhook `PAYMENT.AUTHORIZATION.CREATED` appears verified in the timeline (after updating the webhook URL/ID in the sandbox app — T-071).
4. Upload 6 + 6 photos, run inspections, confirm, accept via renter link, settle.
5. Timeline shows PayPal IDs and verified badges. Billing report shows no unexpected SKUs.

## 10. Public demo access for judges

- Public URL: Cloud Run `*.run.app` (no custom domain).
- Judges need: staff passcode and a dedicated sandbox **buyer** test account. Put both in the Devpost private testing-instructions field (not in the public README); the README explains how to use your own sandbox account instead.
- Keep the service running through **Dec 15, 2026** (judging end). Do not change code after the deadline except organizer-approved fixes.

## 11. Shutdown and cleanup (after judging, ~Dec 16) [OWNER]

```bash
gcloud run services delete holdfast --region us-central1
gcloud storage rm -r gs://<BUCKET>
gcloud artifacts repositories delete cloud-run-source-deploy --location=us-central1
for S in PAYPAL_CLIENT_SECRET PAYPAL_WEBHOOK_ID STAFF_PASSCODE SESSION_SECRET RENTER_LINK_SECRET; do gcloud secrets delete $S; done
# Or shut down the whole project: gcloud projects delete <PROJECT_ID>
```
Also delete the sandbox app's webhook or rotate the sandbox secret. Do not upgrade billing to "keep" anything.
