# SA Gov Demo - Quick Start Guide

This guide provides concise steps to reproduce the successful South African Government demo with ETSI trust list from a clean state.

## Overview

The SA Gov demo creates a complete credential ecosystem with:
- **4 Issuers**: PERSAL (Treasury), DHA (Home Affairs), SARS (Tax), FNB (Bank)
- **5 Credentials**: Employee Status, National ID, Tax Registration, Bank Account, RICA
- **Trust Registry**: ETSI-compliant trust list with all issuers registered
- **Verifier**: DigiGov service requesting all 5 credentials with trust list validation

## Prerequisites

- Docker and Docker Compose installed
- Node.js and pnpm/npm installed
- Repository cloned with walt.id feature branch: `feature/wal-903-etsi-trust-lists`

## Reproduction Steps (From Clean Docker Compose)

### 1. Clean Docker Environment
```bash
cd /Users/jaco/Projects/Liminil/FriendsAndFamily/waltid-enterprise-quickstart
docker-compose down -v  # Remove volumes to clean database
```

### 2. Enable Trust-Registry Feature
Edit `/Users/jaco/Projects/Liminil/FriendsAndFamily/waltid-enterprise-quickstart/config/_features.conf`:

```hocon
enabledFeatures = [
    admin
    dev-mode
    superadmin-registration
    external-authorization-server-for-issuer
    trust-registry  # Add this line
    vical
    x509
    issuer2
    client-attester
]
```

### 3. Start Services
```bash
docker-compose up -d
sleep 15  # Wait for services to fully start
```

### 4. Initialize System (First Time Only)
```bash
npx tsx e2e/journey-sa-gov.ts --init-system
```

This creates:
- Superadmin account (`superadmin@walt.id` / `super123456`)
- `friends` organization
- Base configuration

### 5. Run SA Gov Journey with ETSI Trust List
```bash
npx tsx e2e/journey-sa-gov.ts --etsi-trust-list
```

This creates:
- ✅ `friends.treasury` tenant + wallet + KMS + trust-registry service
- ✅ DigiGov verifier (linked to trust registry)
- ✅ 3 additional tenants: `friends.dha`, `friends.sars`, `friends.fnb`
- ✅ 4 issuers with signing keys (PERSAL, DHA, SARS, FNB)
- ✅ Loads 4 issuers into trust registry (LoTE format)
- ✅ 5 credential profiles
- ✅ 5 credential offers
- ✅ 1 verification session (requesting all 5 credentials with signature + ETSI trust list policies)

### 6. Verify Success
Check the output shows:
```
[SUCCESS] SA Gov Journey completed successfully!
```

And review:
- **Credential Offers** - 5 URLs printed at the end
- **Verification Request** - OpenID4VP URL
- **Working directory** - `e2e/journey-sa-gov-{timestamp}/` with all JSON artifacts

---

## Quick Commands (Copy-Paste)

```bash
# Clean state
cd /Users/jaco/Projects/Liminil/FriendsAndFamily/waltid-enterprise-quickstart
docker-compose down -v

# Enable trust-registry in config/_features.conf (manual edit required)
# Add "trust-registry" to enabledFeatures array

# Start and run
docker-compose up -d
sleep 15
npx tsx e2e/journey-sa-gov.ts --init-system
npx tsx e2e/journey-sa-gov.ts --etsi-trust-list
```

---

## Journey Test Options

```bash
# Show help
npx tsx e2e/journey-sa-gov.ts --help

# Run without ETSI trust list (signature-only verification)
npx tsx e2e/journey-sa-gov.ts

# Run with external trust registry URL
TRUST_REGISTRY_URL=http://localhost:7005 npx tsx e2e/journey-sa-gov.ts --etsi-trust-list

# Re-initialize system (creates fresh superadmin + org)
npx tsx e2e/journey-sa-gov.ts --init-system
```

---

## Trust Registry Endpoints

After successful run, these enterprise trust-registry endpoints are available at the DigiGov tenant:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/friends.treasury.trust-registry/trust-registry-api/sources` | List trust sources |
| GET | `/v1/friends.treasury.trust-registry/trust-registry-api/entities` | List trusted entities |
| GET | `/v1/friends.treasury.trust-registry/trust-registry-api/sources/health` | Get source health |
| GET | `/v1/friends.treasury.trust-registry/trust-registry-api/configuration/view` | View service config |
| POST | `/v1/friends.treasury.trust-registry/trust-registry-api/sources/load` | Load a trust source |
| POST | `/v1/friends.treasury.trust-registry/trust-registry-api/resolve/provider-id` | Resolve trust by provider ID |
| POST | `/v1/friends.treasury.trust-registry/trust-registry-api/resolve/certificate` | Resolve trust by certificate |

**Swagger UI**: http://enterprise.localhost:3000

**Example Request**:
```bash
# Get auth token from journey output
AUTH_TOKEN="<token-from-journey>"

# List trust sources
curl -H "Authorization: Bearer $AUTH_TOKEN" \
     -H "Host: friends.enterprise.localhost" \
     "http://enterprise.localhost:3000/v1/friends.treasury.trust-registry/trust-registry-api/sources"
```

---

## Infrastructure Overview

### Tenants Created
- `friends.treasury` - National Treasury (PERSAL system)
- `friends.dha` - Department of Home Affairs
- `friends.sars` - South African Revenue Service
- `friends.fnb` - First National Bank

### Issuers & Credentials

| Issuer | Tenant | Credential Type | Fields |
|--------|--------|----------------|--------|
| PERSAL | treasury | EmployeeStatusCredential | employeeId, department, position, clearanceLevel |
| DHA | dha | SAIDCredential | idNumber, firstName, lastName, dateOfBirth, nationality |
| SARS | sars | TaxRegistrationCredential | taxNumber, status, validUntil |
| FNB | fnb | BankAccountCredential | accountNumber, accountType, branchCode, accountHolder |
| FNB | fnb | RICACredential | simNumber, registeredAddress, verificationDate, status |

### Services Created
- **Wallet**: `friends.treasury.wallet`
- **KMS**: `friends.treasury.kms` (holds all signing keys)
- **Trust Registry**: `friends.treasury.trust-registry` (LoTE trust source with 4 issuers)
- **Verifier**: `friends.treasury.digigov` (requests all 5 credentials)

---

## Verification Flow

The DigiGov verifier session requests all 5 credentials and applies two policies:

1. **Signature Policy**: Validates cryptographic signature
2. **ETSI Trust List Policy**: Validates issuer is in the trust registry

**Verification Request URL** (example):
```
openid4vp://authorize?client_id=digigov-verifier&request_uri=http%3A%2F%2Ffriends.enterprise.localhost%2Fv1%2Ffriends.treasury.digigov%2Fverifier2-service-api%2F{sessionId}%2Frequest
```

---

## Troubleshooting

### Services not starting
```bash
# Check logs
docker-compose logs -f waltid-enterprise

# Restart specific service
docker-compose restart waltid-enterprise
```

### Trust registry feature not enabled
Verify in `config/_features.conf` that `trust-registry` is in the `enabledFeatures` array.

Check feature status:
```bash
curl http://enterprise.localhost:3000/features/state | jq '.enabled.features["trust-registry"]'
```

Should return: `"Enable or disable Trust Registry Service"`

### Journey test fails
1. Ensure docker services are fully started (`sleep 15` after `docker-compose up`)
2. Check enterprise API health: `curl http://enterprise.localhost:3000/health`
3. Review journey logs in `e2e/journey-sa-gov-{timestamp}/http-log.json`

---

## Output Artifacts

Each journey run creates a timestamped directory with all API requests/responses:

```
e2e/journey-sa-gov-{timestamp}/
├── http-log.json                          # Complete HTTP request/response log
├── login-response.json                    # Auth token
├── create-*-tenant-response.json          # Tenant creation responses
├── create-*-issuer-response.json          # Issuer creation responses
├── create-*-profile-request.json          # Credential profile configs
├── create-*-offer-response.json           # Credential offer URLs
├── trust-registry-lote-source.json        # LoTE trust source format
├── trust-registry-load-response.json      # Trust source load result
├── trust-registry-sources.json            # List of loaded sources
├── verification-session-request.json      # Verifier DCQL query + policies
└── verification-session-response.json     # Session ID + openid4vp URL
```

---

## Next Steps

After running the journey:
1. Update Playwright tests (`play_2_accept.spec.js`, `play_3_verify.spec.js`) with new credential offer URLs
2. Test wallet credential acceptance flow with all 5 issuers
3. Test DigiGov verification requiring all 5 credentials
4. Verify trust list validation during presentation

---

## Related Files

- **Journey Test**: `e2e/journey-sa-gov.ts`
- **Baseline Journey**: `e2e/journey-complete.ts` (reference implementation)
- **Feature Config**: `config/_features.conf`
- **Docker Compose**: `docker-compose.yml`
- **Agent Guidelines**: `../AGENTS.md`
