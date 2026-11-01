# Deploy Holdfast to Cloud Run (T-070, T-071)

Commands only. **Nothing here has been run.** Each block marked **[APPROVAL]** creates or changes
cloud resources: the owner runs it, or explicitly approves that block. Run in Git Bash from the repo
root. Background: `docs/DEPLOYMENT.md` §2 (costs), §5–§10.

## 0. Sign in (owner, interactive)

If the gcloud CLI token has expired, sign in again. Application Default Credentials are separate.

```bash
gcloud auth login <ACCOUNT>
```

## 1. Variables

```bash
ACCOUNT=<your-google-account>
G="gcloud --account $ACCOUNT --project holdfast-demo-2026"
PROJECT=holdfast-demo-2026
REGION=us-central1
BUCKET=holdfast-demo-2026-media
SA=holdfast-run@$PROJECT.iam.gserviceaccount.com
```

## 2. Read-only pre-checks (free, change nothing)

```bash
# Is public access (allUsers) restricted by your organization?
$G org-policies describe iam.allowedPolicyMemberDomains --effective
$G org-policies describe iam.managed.allowedPolicyMembers --effective
# Which APIs are already on?
$G services list --enabled --format="value(config.name)"
# Pre-deploy checklist (T-063)
npm run typecheck && npm run lint && npm test && npm run build && npm run check:secrets
```

If either org policy lists allowed domains (for example only your school or company domain), `--allow-unauthenticated`
will fail; see §7 for the fallback.

## 3. [APPROVAL A] Enable APIs

```bash
$G services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
```

## 4. [APPROVAL B] Runtime service account (least privilege)

```bash
$G iam service-accounts create holdfast-run --display-name="Holdfast Cloud Run"
$G projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/datastore.user
$G projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/aiplatform.user
gcloud --account $ACCOUNT storage buckets add-iam-policy-binding gs://$BUCKET --member=serviceAccount:$SA --role=roles/storage.objectAdmin
```

Not granted on purpose: `iam.serviceAccountTokenCreator` (no signed URLs; photos go through
authenticated app routes). If the first source deploy fails with a Cloud Build permission error, grant
the build service account `roles/run.builder` as the error message names it.

## 5. [APPROVAL C] Secrets (values never printed, never typed into chat)

```bash
# From .env.local, without echoing:
for S in PAYPAL_CLIENT_SECRET; do
  grep "^$S=" .env.local | cut -d= -f2- | tr -d '\r\n' | $G secrets create $S --data-file=-
done
# Fresh production values (different from local dev):
openssl rand -base64 48 | tr -d '\r\n' | $G secrets create SESSION_SECRET --data-file=-
openssl rand -base64 48 | tr -d '\r\n' | $G secrets create RENTER_LINK_SECRET --data-file=-
# Staff passcode for judges: choose one, type it at the prompt (not echoed):
read -rs -p "Production staff passcode: " P && printf '%s' "$P" | $G secrets create STAFF_PASSCODE --data-file=- && unset P
for S in PAYPAL_CLIENT_SECRET SESSION_SECRET RENTER_LINK_SECRET STAFF_PASSCODE; do
  $G secrets add-iam-policy-binding $S --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
done
```

`PAYPAL_WEBHOOK_ID` is created in §8, after the service has a URL.

## 6. Seed production data (Firestore + bucket already exist; free tier)

Production uses collections without a prefix (`items`, `rentals`, …). The `rentals` composite index
already exists.

```bash
npm run seed -- --production --dry-run
npm run seed -- --production
```

## 7. [APPROVAL D] Build and deploy

Cloud Build builds the `Dockerfile` from the source uploaded through `.gcloudignore` (which excludes
`.env*`, private photos and recordings). Read the client id from `.env.local` into a variable:

```bash
PAYPAL_CLIENT_ID=$(grep '^PAYPAL_CLIENT_ID=' .env.local | cut -d= -f2- | tr -d '\r\n')
$G run deploy holdfast --source . --region $REGION \
  --service-account $SA --allow-unauthenticated \
  --min-instances 0 --max-instances 2 --cpu 1 --memory 1Gi --concurrency 20 --timeout 120 \
  --set-env-vars "PAYPAL_ENV=sandbox,PAYPAL_CLIENT_ID=$PAYPAL_CLIENT_ID,NEXT_PUBLIC_PAYPAL_CLIENT_ID=$PAYPAL_CLIENT_ID,SETTLEMENT_MODE=PARTIAL_CAPTURE_THEN_VOID,GCP_PROJECT_ID=$PROJECT,GCP_REGION=$REGION,GCS_BUCKET=$BUCKET,VERTEX_LOCATION=global,GEMINI_MODEL=gemini-3.7-flash,AI_MODE=live,AI_DAILY_CALL_LIMIT=150,FIRESTORE_COLLECTION_PREFIX=" \
  --set-secrets "PAYPAL_CLIENT_SECRET=PAYPAL_CLIENT_SECRET:latest,STAFF_PASSCODE=STAFF_PASSCODE:latest,SESSION_SECRET=SESSION_SECRET:latest,RENTER_LINK_SECRET=RENTER_LINK_SECRET:latest"

URL=$($G run services describe holdfast --region $REGION --format='value(status.url)')
$G run services update holdfast --region $REGION --update-env-vars APP_BASE_URL=$URL
echo "$URL"
```

If `--allow-unauthenticated` fails because the organization restricts `allUsers`, use Cloud Run's
built-in public access setting instead (verify the flag in `gcloud run services update --help`):

```bash
$G run services update holdfast --region $REGION --no-invoker-iam-check
```

## 8. [APPROVAL E] PayPal webhook for the deployed URL (T-071, owner in the PayPal dashboard)

1. Developer dashboard → your sandbox app → Webhooks → **Add webhook**: URL `$URL/api/webhooks/paypal`,
   events `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`,
   `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`.
2. Copy the new webhook ID, then:

```bash
read -rs -p "Webhook ID: " W && printf '%s' "$W" | $G secrets create PAYPAL_WEBHOOK_ID --data-file=- && unset W
$G secrets add-iam-policy-binding PAYPAL_WEBHOOK_ID --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
$G run services update holdfast --region $REGION --update-secrets PAYPAL_WEBHOOK_ID=PAYPAL_WEBHOOK_ID:latest
```

## 9. Smoke test (owner; `docs/DEPLOYMENT.md` §9)

Open `$URL`: sandbox banner → book with the sandbox buyer → staff page shows AUTHORIZED and, within
about a minute, a "PayPal-confirmed" badge from the verified webhook → full flow → Settle → receipt.

## 10. Cost guards (owner, console)

- Billing → Budgets & alerts: budget on this project with low thresholds, credits excluded (§7).
- Artifact Registry → `cloud-run-source-deploy` → Cleanup policy: keep the 3 most recent versions.
- `--max-instances 2` and `--min-instances 0`: no idle cost; at most 2 instances.
