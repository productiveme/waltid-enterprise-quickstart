#!/usr/bin/env node
/**
 * South African Government Demo - Complete Journey Test
 * 
 * This test sets up a complete verifiable credential ecosystem for:
 * - Treasury (PERSAL): EmployeeStatusCredential
 * - DHA (Home Affairs): SAIDCredential (National ID)
 * - SARS (Tax): TaxRegistrationCredential
 * - FNB (Bank): BankAccountCredential + RICACredential
 * - DigiGov (Verifier): Verifies all credentials with client attestation
 * 
 * Organization: friends
 * Tenant: treasury
 * 
 * Run:
 *   npx tsx e2e/journey-sa-gov.ts --init-system
 *   npx tsx e2e/journey-sa-gov.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
interface Config {
  baseUrl: string;
  organization: string;
  tenant: string;
  email: string;
  password: string;
  port: number;
  superadminToken?: string;
  useEtsiTrustList?: boolean;  // Enable ETSI Trust List validation
  trustRegistryUrl?: string;    // URL of external trust registry service
}

interface HttpResponse<T = any> {
  data: T;
  headers: Record<string, string>;
}

interface JourneyContext {
  token: string;
  workdir: string;
  tenantPath: string;
  orgBaseUrl: string;
  orgServiceBaseUrl: string;  // Base URL for service creation (without port)
  walletKeyRef: string;
  
  // Trust registry
  trustRegistrySourceId: string;
  
  // Issuer signing keys (for trust registry)
  persalSigningKeyId: string;
  dhaSigningKeyId: string;
  sarsSigningKeyId: string;
  fnbSigningKeyId: string;
  
  // Issuers
  persalProfileId: string;
  dhaProfileId: string;
  sarsProfileId: string;
  fnbProfileId: string;
  
  // Credential offers
  employeeOfferUrl: string;
  saidOfferUrl: string;
  taxOfferUrl: string;
  bankAccountOfferUrl: string;
  ricaOfferUrl: string;
  
  // Verification
  verificationSessionId: string;
  verificationRequestUrl: string;
}

// Constants
const RESOURCES = {
  wallet: 'wallet',
  kms: 'kms',
  digigov: 'digigov',  // DigiGov verifier
  trustRegistry: 'trust-registry',  // Trust registry service
  
  // Issuers
  persal: 'persal',
  dha: 'issuer',  // DHA issuer
  sars: 'issuer',  // SARS issuer
  fnb: 'issuer',   // FNB issuer
};

const CREDENTIALS = {
  employeeStatus: 'EmployeeStatusCredential',
  said: 'SAIDCredential',
  taxRegistration: 'TaxRegistrationCredential',
  bankAccount: 'BankAccountCredential',
  rica: 'RICACredential',
};

// HTTP Client
class HttpClient {
  private token: string = '';
  private requestLog: any[] = [];

  constructor(private baseUrl: string) {}

  setToken(token: string) {
    this.token = token;
  }

  getLog() {
    return this.requestLog;
  }

  async request<T = any>(
    method: string,
    path: string,
    body?: any,
    contentType: string = 'application/json',
    skipStringify: boolean = false
  ): Promise<HttpResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': contentType,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const logEntry: any = { method, url, body };
    this.requestLog.push(logEntry);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? (
          skipStringify ? body :
          contentType === 'application/json' ? JSON.stringify(body) : body
        ) : undefined,
      });

      const responseText = await response.text();
      let data: any;
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        data = responseText;
      }

      Object.assign(logEntry, { response: data, status: response.status });

      if (!response.ok) {
        const errorMsg = `HTTP ${response.status}: ${JSON.stringify(data, null, 2)}`;
        logEntry.error = errorMsg;
        throw new Error(errorMsg);
      }

      return {
        data,
        headers: Object.fromEntries(response.headers.entries()),
      };
    } catch (error: any) {
      logEntry.error = error.message;
      throw error;
    }
  }

  async get<T = any>(path: string): Promise<HttpResponse<T>> {
    return this.request<T>('GET', path);
  }

  async post<T = any>(path: string, body?: any): Promise<HttpResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  async put<T = any>(path: string, body?: any): Promise<HttpResponse<T>> {
    return this.request<T>('PUT', path, body);
  }

  async delete<T = any>(path: string): Promise<HttpResponse<T>> {
    return this.request<T>('DELETE', path);
  }
}

// ============================================================================
// Journey Runner
// ============================================================================
class SAGovJourney {
  private client: HttpClient;
  private orgClient: HttpClient;
  private ctx: Partial<JourneyContext> = {};
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    
    this.ctx = {
      workdir: join(__dirname, `journey-sa-gov-${timestamp}`),
      tenantPath: `${config.organization}.${config.tenant}`,
      orgBaseUrl: `http://${config.organization}.${config.baseUrl.replace('http://', '')}:${config.port}`,
      orgServiceBaseUrl: `http://${config.organization}.${config.baseUrl.replace('http://', '')}`,
      token: '',
      walletKeyRef: '',
      persalProfileId: '',
      dhaProfileId: '',
      sarsProfileId: '',
      fnbProfileId: '',
      employeeOfferUrl: '',
      saidOfferUrl: '',
      taxOfferUrl: '',
      bankAccountOfferUrl: '',
      ricaOfferUrl: '',
      verificationSessionId: '',
      verificationRequestUrl: '',
    };

    this.client = new HttpClient(`http://${config.baseUrl}:${config.port}`);
    this.orgClient = new HttpClient(this.ctx.orgBaseUrl!);
  }

  log(message: string) {
    console.log(`\n>> ${message}`);
  }

  saveJson(filename: string, data: any) {
    const path = join(this.ctx.workdir!, filename);
    writeFileSync(path, JSON.stringify(data, null, 2));
  }

  async run() {
    mkdirSync(this.ctx.workdir!, { recursive: true });

    console.log('[START] South African Government Demo Journey');
    console.log(`Working directory: ${this.ctx.workdir}`);
    console.log(`Base URL: ${this.config.baseUrl}:${this.config.port}`);
    console.log(`Organization: ${this.config.organization}`);
    console.log(`Tenant: ${this.config.tenant}`);
    if (this.config.useEtsiTrustList) {
      console.log(`ETSI Trust List: ENABLED (external: ${this.config.trustRegistryUrl})`);
    }
    console.log('');

    try {
      await this.login();
      await this.createTenant();  // Treasury tenant
      await this.createWallet();
      await this.createKMS();
      
      // Create trust registry and verifier (conditional based on ETSI trust list flag)
      if (this.config.useEtsiTrustList) {
        await this.createTrustRegistry();
        await this.createDigiGovVerifier();  // Will reference trust registry
      } else {
        await this.createDigiGovVerifierWithoutTrustRegistry();  // No trust registry
      }
      
      // Create tenants for other departments
      await this.createDHATenant();
      await this.createSARSTenant();
      await this.createFNBTenant();
      
      // Create all issuers
      await this.createPersalIssuer();
      await this.createDHAIssuer();
      await this.createSARSIssuer();
      await this.createFNBIssuer();
      
      // Load issuer certificates into trust registry (only if ETSI enabled)
      if (this.config.useEtsiTrustList) {
        await this.loadTrustSourceIntoRegistry();
      }
      
      // Create credential profiles
      await this.createEmployeeStatusProfile();
      await this.createSAIDProfile();
      await this.createTaxRegistrationProfile();
      await this.createBankAccountProfile();
      await this.createRICAProfile();
      
      // Create credential offers
      await this.createEmployeeStatusOffer();
      await this.createSAIDOffer();
      await this.createTaxRegistrationOffer();
      await this.createBankAccountOffer();
      await this.createRICAOffer();
      
      // Create verification session
      await this.createVerificationSession();
      
      console.log('\n' + '='.repeat(80));
      console.log('[SUCCESS] SA Gov Journey completed successfully!');
      console.log('='.repeat(80));
      console.log('\nCredential Offers:');
      console.log(`  1. Employee Status: ${this.ctx.employeeOfferUrl}`);
      console.log(`  2. SAID (National ID): ${this.ctx.saidOfferUrl}`);
      console.log(`  3. Tax Registration: ${this.ctx.taxOfferUrl}`);
      console.log(`  4. Bank Account: ${this.ctx.bankAccountOfferUrl}`);
      console.log(`  5. RICA: ${this.ctx.ricaOfferUrl}`);
      console.log(`\nVerification Request: ${this.ctx.verificationRequestUrl}`);
      console.log(`\nWorkingdirectory: ${this.ctx.workdir}`);
      
    } catch (error: any) {
      console.error('\n[ERROR] Journey failed:', error.message);
      throw error;
    } finally {
      const httpLog = join(this.ctx.workdir!, 'http-log.json');
      writeFileSync(httpLog, JSON.stringify(this.orgClient.getLog(), null, 2));
      console.log(`\nLog saved: HTTP log saved: ${httpLog}`);
    }
  }

  async login() {
    this.log('Login');
    const response = await this.client.post('/auth/account/emailpass', {
      email: this.config.email,
      password: this.config.password,
    });
    this.ctx.token = response.data.token;
    this.orgClient.setToken(this.ctx.token!);
    this.saveJson('login-response.json', response.data);
    console.log('   [OK] Logged in successfully');
  }

  async createTenant() {
    this.log('Create tenant');
    const request = {
      name: 'South African Government Demo Tenant',
    };

    try {
      const response = await this.orgClient.post(
        `/v1/${this.ctx.tenantPath}/resource-api/tenants/create`,
        request
      );
      this.saveJson('create-tenant-response.json', response.data);
      console.log(`   [OK] Tenant created: ${this.ctx.tenantPath}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] Tenant already exists`);
      } else {
        throw error;
      }
    }
  }

  async createWallet() {
    this.log('Initialize wallet');
    const request = {
      createKeyInKms: {
        keyType: 'secp256r1',
      },
    };

    try {
      const response = await this.orgClient.post(
        `/v1/${this.ctx.tenantPath}/wallet-service-api/init-wallet`,
        request
      );
      this.saveJson('init-wallet-response.json', response.data);
      this.ctx.walletKeyRef = `${this.ctx.tenantPath}.${RESOURCES.kms}.wallet_key`;
      console.log(`   [OK] Wallet initialized: ${this.ctx.tenantPath}.${RESOURCES.wallet}`);
    } catch (error: any) {
      if (error.message?.includes('already exists') || error.message?.includes('already initialized')) {
        this.ctx.walletKeyRef = `${this.ctx.tenantPath}.${RESOURCES.kms}.wallet_key`;
        console.log(`   [OK] Wallet already initialized`);
      } else {
        throw error;
      }
    }
  }

  async createTrustRegistry() {
    this.log('Create Trust Registry Service');
    
    const request = {
      type: 'trust-registry-service',
      _id: `${this.ctx.tenantPath}.${RESOURCES.trustRegistry}`,
      validateSignaturesByDefault: false,  // For demo, skip signature validation
      autoRefreshIntervalSeconds: 0,       // No auto-refresh for demo
    };
    
    this.saveJson('create-trust-registry-request.json', request);
    
    try {
      const response = await this.orgClient.post(
        `/v1/${this.ctx.tenantPath}.${RESOURCES.trustRegistry}/resource-api/services/create`,
        request
      );
      this.saveJson('create-trust-registry-response.json', response.data);
      console.log(`   [OK] Trust Registry created: ${this.ctx.tenantPath}.${RESOURCES.trustRegistry}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] Trust Registry already exists`);
      } else {
        throw error;
      }
    }
  }

  async createDigiGovVerifier() {
    this.log('Create DigiGov verifier with trust registry');
    const trustRegistryTarget = `${this.ctx.tenantPath}.${RESOURCES.trustRegistry}`;
    
    const request = {
      type: 'verifier2',
      baseUrl: this.ctx.orgServiceBaseUrl,
      clientId: 'digigov-verifier',
      trustRegistryService: trustRegistryTarget,
    };
    this.saveJson('create-digigov-request.json', request);
    
    try {
      const response = await this.orgClient.post(
        `/v1/${this.ctx.tenantPath}.${RESOURCES.digigov}/resource-api/services/create`,
        request
      );
      this.saveJson('create-digigov-response.json', response.data);
      console.log(`   [OK] DigiGov verifier created: ${this.ctx.tenantPath}.${RESOURCES.digigov}`);
      console.log(`        Trust registry linked: ${trustRegistryTarget}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] DigiGov verifier already exists`);
      } else {
        throw error;
      }
    }
  }

  async createDigiGovVerifierWithoutTrustRegistry() {
    this.log('Create DigiGov verifier (without trust registry)');
    
    const request = {
      type: 'verifier2',
      baseUrl: this.ctx.orgServiceBaseUrl,
      clientId: 'digigov-verifier',
    };
    this.saveJson('create-digigov-request.json', request);
    
    try {
      const response = await this.orgClient.post(
        `/v1/${this.ctx.tenantPath}.${RESOURCES.digigov}/resource-api/services/create`,
        request
      );
      this.saveJson('create-digigov-response.json', response.data);
      console.log(`   [OK] DigiGov verifier created: ${this.ctx.tenantPath}.${RESOURCES.digigov}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] DigiGov verifier already exists`);
      } else {
        throw error;
      }
    }
  }

  async createKMS() {
    this.log('Create KMS');
    try {
      const response = await this.orgClient.post(
        `/v1/${this.ctx.tenantPath}.${RESOURCES.kms}/resource-api/services/create`,
        { type: 'kms' }
      );
      this.saveJson('create-kms-response.json', response.data);
      console.log(`   [OK] KMS created: ${this.ctx.tenantPath}.${RESOURCES.kms}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] KMS already exists`);
      } else {
        throw error;
      }
    }
  }

  async createDHATenant() {
    this.log('Create DHA tenant');
    const request = {
      name: 'Department of Home Affairs',
    };

    try {
      const response = await this.orgClient.post(
        `/v1/${this.config.organization}.dha/resource-api/tenants/create`,
        request
      );
      console.log(`   [OK] DHA tenant created: ${this.config.organization}.dha`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] DHA tenant already exists`);
      } else {
        throw error;
      }
    }
  }

  async createSARSTenant() {
    this.log('Create SARS tenant');
    const request = {
      name: 'South African Revenue Service',
    };

    try {
      const response = await this.orgClient.post(
        `/v1/${this.config.organization}.sars/resource-api/tenants/create`,
        request
      );
      console.log(`   [OK] SARS tenant created: ${this.config.organization}.sars`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] SARS tenant already exists`);
      } else {
        throw error;
      }
    }
  }

  async createFNBTenant() {
    this.log('Create FNB tenant');
    const request = {
      name: 'First National Bank',
    };

    try {
      const response = await this.orgClient.post(
        `/v1/${this.config.organization}.fnb/resource-api/tenants/create`,
        request
      );
      console.log(`   [OK] FNB tenant created: ${this.config.organization}.fnb`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] FNB tenant already exists`);
      } else {
        throw error;
      }
    }
  }

  async createPersalIssuer() {
    this.log('Create PERSAL issuer (Treasury)');
    const issuerPath = `${this.config.organization}.${this.config.tenant}.${RESOURCES.persal}`;
    const keyId = `persal-signing-key`;
    const fullKeyId = `${this.ctx.tenantPath}.${RESOURCES.kms}.${keyId}`;
    
    // Create signing key
    try {
      await this.orgClient.post(
        `/v1/${fullKeyId}/kms-service-api/keys/generate`,
        {
          backend: 'jwk',
          keyType: 'secp256r1',
        }
      );
      console.log(`   [OK] PERSAL signing key created: ${keyId}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] PERSAL signing key already exists`);
      } else {
        throw error;
      }
    }
    
    // Store key ID for trust registry
    this.ctx.persalSigningKeyId = fullKeyId;
    
    // Create issuer
    const request = {
      type: 'issuer2',
      _id: issuerPath,
      tokenKeyId: fullKeyId,
      kms: `${this.ctx.tenantPath}.${RESOURCES.kms}`,
      credentialConfigurations: {
        [CREDENTIALS.employeeStatus]: {
          format: 'jwt_vc_json',
          scope: CREDENTIALS.employeeStatus,
          cryptographic_binding_methods_supported: ['did:key'],
          credential_signing_alg_values_supported: ['ES256'],
          proof_types_supported: {
            jwt: {
              proof_signing_alg_values_supported: ['ES256'],
            },
          },
          credential_definition: {
            type: ['VerifiableCredential', CREDENTIALS.employeeStatus],
          },
        },
      },
    };
    
    try {
      const response = await this.orgClient.post(
        `/v1/${issuerPath}/resource-api/services/create`,
        request
      );
      this.saveJson('create-persal-issuer-response.json', response.data);
      console.log(`   [OK] PERSAL issuer created: ${issuerPath}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] PERSAL issuer already exists`);
      } else {
        throw error;
      }
    }
  }

  async createDHAIssuer() {
    this.log('Create DHA issuer (Home Affairs)');
    const issuerPath = `${this.config.organization}.dha.${RESOURCES.dha}`;
    const keyId = `dha-signing-key`;
    const fullKeyId = `${this.ctx.tenantPath}.${RESOURCES.kms}.${keyId}`;
    
    // Create signing key
    try {
      await this.orgClient.post(
        `/v1/${fullKeyId}/kms-service-api/keys/generate`,
        {
          backend: 'jwk',
          keyType: 'secp256r1',
        }
      );
      console.log(`   [OK] DHA signing key created: ${keyId}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] DHA signing key already exists`);
      } else {
        throw error;
      }
    }
    
    // Store key ID for trust registry
    this.ctx.dhaSigningKeyId = fullKeyId;
    
    // Create issuer
    const request = {
      type: 'issuer2',
      _id: issuerPath,
      tokenKeyId: fullKeyId,
      kms: `${this.ctx.tenantPath}.${RESOURCES.kms}`,
      credentialConfigurations: {
        [CREDENTIALS.said]: {
          format: 'jwt_vc_json',
          scope: CREDENTIALS.said,
          cryptographic_binding_methods_supported: ['did:key'],
          credential_signing_alg_values_supported: ['ES256'],
          proof_types_supported: {
            jwt: {
              proof_signing_alg_values_supported: ['ES256'],
            },
          },
          credential_definition: {
            type: ['VerifiableCredential', CREDENTIALS.said],
          },
        },
      },
    };
    
    try {
      const response = await this.orgClient.post(
        `/v1/${issuerPath}/resource-api/services/create`,
        request
      );
      this.saveJson('create-dha-issuer-response.json', response.data);
      console.log(`   [OK] DHA issuer created: ${issuerPath}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] DHA issuer already exists`);
      } else {
        throw error;
      }
    }
  }

  async createSARSIssuer() {
    this.log('Create SARS issuer (Tax Authority)');
    const issuerPath = `${this.config.organization}.sars.${RESOURCES.sars}`;
    const keyId = `sars-signing-key`;
    const fullKeyId = `${this.ctx.tenantPath}.${RESOURCES.kms}.${keyId}`;
    
    // Create signing key
    try {
      await this.orgClient.post(
        `/v1/${fullKeyId}/kms-service-api/keys/generate`,
        {
          backend: 'jwk',
          keyType: 'secp256r1',
        }
      );
      console.log(`   [OK] SARS signing key created: ${keyId}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] SARS signing key already exists`);
      } else {
        throw error;
      }
    }
    
    // Store key ID for trust registry
    this.ctx.sarsSigningKeyId = fullKeyId;
    
    // Create issuer
    const request = {
      type: 'issuer2',
      _id: issuerPath,
      tokenKeyId: fullKeyId,
      kms: `${this.ctx.tenantPath}.${RESOURCES.kms}`,
      credentialConfigurations: {
        [CREDENTIALS.taxRegistration]: {
          format: 'jwt_vc_json',
          scope: CREDENTIALS.taxRegistration,
          cryptographic_binding_methods_supported: ['did:key'],
          credential_signing_alg_values_supported: ['ES256'],
          proof_types_supported: {
            jwt: {
              proof_signing_alg_values_supported: ['ES256'],
            },
          },
          credential_definition: {
            type: ['VerifiableCredential', CREDENTIALS.taxRegistration],
          },
        },
      },
    };
    
    try {
      const response = await this.orgClient.post(
        `/v1/${issuerPath}/resource-api/services/create`,
        request
      );
      this.saveJson('create-sars-issuer-response.json', response.data);
      console.log(`   [OK] SARS issuer created: ${issuerPath}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] SARS issuer already exists`);
      } else {
        throw error;
      }
    }
  }

  async createFNBIssuer() {
    this.log('Create FNB issuer (Bank)');
    const issuerPath = `${this.config.organization}.fnb.${RESOURCES.fnb}`;
    const keyId = `fnb-signing-key`;
    const fullKeyId = `${this.ctx.tenantPath}.${RESOURCES.kms}.${keyId}`;
    
    // Create signing key
    try {
      await this.orgClient.post(
        `/v1/${fullKeyId}/kms-service-api/keys/generate`,
        {
          backend: 'jwk',
          keyType: 'secp256r1',
        }
      );
      console.log(`   [OK] FNB signing key created: ${keyId}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] FNB signing key already exists`);
      } else {
        throw error;
      }
    }
    
    // Store key ID for trust registry
    this.ctx.fnbSigningKeyId = fullKeyId;
    
    // Create issuer with both BankAccount and RICA credentials
    const request = {
      type: 'issuer2',
      _id: issuerPath,
      tokenKeyId: fullKeyId,
      kms: `${this.ctx.tenantPath}.${RESOURCES.kms}`,
      credentialConfigurations: {
        [CREDENTIALS.bankAccount]: {
          format: 'jwt_vc_json',
          scope: CREDENTIALS.bankAccount,
          cryptographic_binding_methods_supported: ['did:key'],
          credential_signing_alg_values_supported: ['ES256'],
          proof_types_supported: {
            jwt: {
              proof_signing_alg_values_supported: ['ES256'],
            },
          },
          credential_definition: {
            type: ['VerifiableCredential', CREDENTIALS.bankAccount],
          },
        },
        [CREDENTIALS.rica]: {
          format: 'jwt_vc_json',
          scope: CREDENTIALS.rica,
          cryptographic_binding_methods_supported: ['did:key'],
          credential_signing_alg_values_supported: ['ES256'],
          proof_types_supported: {
            jwt: {
              proof_signing_alg_values_supported: ['ES256'],
            },
          },
          credential_definition: {
            type: ['VerifiableCredential', CREDENTIALS.rica],
          },
        },
      },
    };
    
    try {
      const response = await this.orgClient.post(
        `/v1/${issuerPath}/resource-api/services/create`,
        request
      );
      this.saveJson('create-fnb-issuer-response.json', response.data);
      console.log(`   [OK] FNB issuer created: ${issuerPath}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] FNB issuer already exists`);
      } else {
        throw error;
      }
    }
  }

  async loadTrustSourceIntoRegistry() {
    this.log('Load SA Gov issuers into Trust Registry');
    
    const sourceId = `sa-gov-issuers-${Date.now()}`;
    
    // Create a LoTE-format JSON source with all SA Gov issuer keys
    // Note: In a real scenario, these would be certificate chains, but for demo
    // we're using DID:key identifiers from the signing keys
    const loteSource = {
      listMetadata: {
        listId: sourceId,
        listType: 'credential-issuers',
        territory: 'ZA',  // South Africa
        issueDate: new Date().toISOString(),
        nextUpdate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        sequenceNumber: '1',
      },
      trustedEntities: [
        {
          entityId: 'treasury-persal',
          entityType: 'PID_PROVIDER',
          legalName: 'South African National Treasury - PERSAL',
          country: 'ZA',
          services: [
            {
              serviceId: 'employee-credential-issuing',
              serviceType: 'CREDENTIAL_ISSUER',
              status: 'GRANTED',
              statusStart: new Date().toISOString(),
              identities: [
                {
                  matchType: 'DID_KEY',
                  value: this.ctx.persalSigningKeyId,
                },
              ],
            },
          ],
        },
        {
          entityId: 'dha',
          entityType: 'PID_PROVIDER',
          legalName: 'Department of Home Affairs',
          country: 'ZA',
          services: [
            {
              serviceId: 'id-credential-issuing',
              serviceType: 'CREDENTIAL_ISSUER',
              status: 'GRANTED',
              statusStart: new Date().toISOString(),
              identities: [
                {
                  matchType: 'DID_KEY',
                  value: this.ctx.dhaSigningKeyId,
                },
              ],
            },
          ],
        },
        {
          entityId: 'sars',
          entityType: 'PID_PROVIDER',
          legalName: 'South African Revenue Service',
          country: 'ZA',
          services: [
            {
              serviceId: 'tax-credential-issuing',
              serviceType: 'CREDENTIAL_ISSUER',
              status: 'GRANTED',
              statusStart: new Date().toISOString(),
              identities: [
                {
                  matchType: 'DID_KEY',
                  value: this.ctx.sarsSigningKeyId,
                },
              ],
            },
          ],
        },
        {
          entityId: 'fnb',
          entityType: 'PID_PROVIDER',
          legalName: 'First National Bank',
          country: 'ZA',
          services: [
            {
              serviceId: 'bank-credential-issuing',
              serviceType: 'CREDENTIAL_ISSUER',
              status: 'GRANTED',
              statusStart: new Date().toISOString(),
              identities: [
                {
                  matchType: 'DID_KEY',
                  value: this.ctx.fnbSigningKeyId,
                },
              ],
            },
          ],
        },
      ],
    };
    
    this.saveJson('trust-registry-lote-source.json', loteSource);
    
    // Load via enterprise API
    const loadRequest = {
      sourceId: sourceId,
      content: JSON.stringify(loteSource),
      sourceUrl: 'local://sa-gov-demo',
      validateSignature: false,  // Demo source, no signature
    };
    
    this.saveJson('trust-registry-load-request.json', loadRequest);
    
    try {
      const response = await this.orgClient.post(
        `/v1/${this.ctx.tenantPath}.${RESOURCES.trustRegistry}/trust-registry-api/sources/load`,
        loadRequest
      );
      this.saveJson('trust-registry-load-response.json', response.data);
      
      if (!response.data.success) {
        throw new Error(`Trust registry load failed: ${response.data.error || 'unknown error'}`);
      }
      
      this.ctx.trustRegistrySourceId = sourceId;
      console.log(`   [OK] Trust source loaded: ${sourceId}`);
      console.log(`        Entities: ${response.data.entitiesLoaded || 0}`);
      console.log(`        Services: ${response.data.servicesLoaded || 0}`);
      console.log(`        Identities: ${response.data.identitiesLoaded || 0}`);
    } catch (error: any) {
      console.error(`   [ERROR] Failed to load trust source: ${error.message}`);
      throw error;
    }
    
    // Verify by listing sources
    try {
      const sourcesResponse = await this.orgClient.get(
        `/v1/${this.ctx.tenantPath}.${RESOURCES.trustRegistry}/trust-registry-api/sources`
      );
      this.saveJson('trust-registry-sources.json', sourcesResponse.data);
      console.log(`   [OK] Trust registry now has ${sourcesResponse.data?.length || 0} source(s)`);
    } catch (error: any) {
      console.log(`   [WARN] Could not list sources: ${error.message}`);
    }
  }

  async createEmployeeStatusProfile() {
    this.log('Create EmployeeStatusCredential profile');
    const issuerPath = `${this.config.organization}.${this.config.tenant}.${RESOURCES.persal}`;
    const profileId = 'employee-profile';
    
    const request = {
      name: profileId,
      credentialConfigurationId: CREDENTIALS.employeeStatus,
      issuerKeyId: `${this.ctx.tenantPath}.${RESOURCES.kms}.persal-signing-key`,
      credentialData: {
        employeeId: '12345',
        department: 'Treasury',
        position: 'Senior Analyst',
        clearanceLevel: 'Secret',
      },
    };
    
    this.saveJson('create-employee-profile-request.json', request);
    
    try {
      const response = await this.orgClient.post(
        `/v2/${issuerPath}.${profileId}/issuer-service-api/credentials/profiles`,
        request
      );
      this.saveJson('create-employee-profile-response.json', response.data);
      console.log(`   [OK] EmployeeStatusCredential profile created: ${issuerPath}.${profileId}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] EmployeeStatusCredential profile already exists`);
      } else {
        throw error;
      }
    }
  }

  async createSAIDProfile() {
    this.log('Create SAIDCredential profile (National ID)');
    const issuerPath = `${this.config.organization}.dha.${RESOURCES.dha}`;
    const profileId = 'said-profile';
    
    const request = {
      name: profileId,
      credentialConfigurationId: CREDENTIALS.said,
      issuerKeyId: `${this.ctx.tenantPath}.${RESOURCES.kms}.dha-signing-key`,
      credentialData: {
        idNumber: '8001015009087',
        firstName: 'Test',
        lastName: 'User',
        dateOfBirth: '1980-01-01',
        nationality: 'ZA',
      },
    };
    
    this.saveJson('create-said-profile-request.json', request);
    
    try {
      const response = await this.orgClient.post(
        `/v2/${issuerPath}.${profileId}/issuer-service-api/credentials/profiles`,
        request
      );
      this.saveJson('create-said-profile-response.json', response.data);
      console.log(`   [OK] SAIDCredential profile created: ${issuerPath}.${profileId}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] SAIDCredential profile already exists`);
      } else {
        throw error;
      }
    }
  }

  async createTaxRegistrationProfile() {
    this.log('Create TaxRegistrationCredential profile');
    const issuerPath = `${this.config.organization}.sars.${RESOURCES.sars}`;
    const profileId = 'tax-profile';
    
    const request = {
      name: profileId,
      credentialConfigurationId: CREDENTIALS.taxRegistration,
      issuerKeyId: `${this.ctx.tenantPath}.${RESOURCES.kms}.sars-signing-key`,
      credentialData: {
        taxNumber: '9876543210',
        status: 'Compliant',
        validUntil: '2025-12-31',
      },
    };
    
    this.saveJson('create-tax-profile-request.json', request);
    
    try {
      const response = await this.orgClient.post(
        `/v2/${issuerPath}.${profileId}/issuer-service-api/credentials/profiles`,
        request
      );
      this.saveJson('create-tax-profile-response.json', response.data);
      console.log(`   [OK] TaxRegistrationCredential profile created: ${issuerPath}.${profileId}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] TaxRegistrationCredential profile already exists`);
      } else {
        throw error;
      }
    }
  }

  async createBankAccountProfile() {
    this.log('Create BankAccountCredential profile');
    const issuerPath = `${this.config.organization}.fnb.${RESOURCES.fnb}`;
    const profileId = 'bank-account-profile';
    
    const request = {
      name: profileId,
      credentialConfigurationId: CREDENTIALS.bankAccount,
      issuerKeyId: `${this.ctx.tenantPath}.${RESOURCES.kms}.fnb-signing-key`,
      credentialData: {
        accountNumber: '62123456789',
        accountType: 'Cheque',
        branchCode: '250655',
        accountHolder: 'Test User',
      },
    };
    
    this.saveJson('create-bank-account-profile-request.json', request);
    
    try {
      const response = await this.orgClient.post(
        `/v2/${issuerPath}.${profileId}/issuer-service-api/credentials/profiles`,
        request
      );
      this.saveJson('create-bank-account-profile-response.json', response.data);
      console.log(`   [OK] BankAccountCredential profile created: ${issuerPath}.${profileId}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] BankAccountCredential profile already exists`);
      } else {
        throw error;
      }
    }
  }

  async createRICAProfile() {
    this.log('Create RICACredential profile');
    const issuerPath = `${this.config.organization}.fnb.${RESOURCES.fnb}`;
    const profileId = 'rica-profile';
    
    const request = {
      name: profileId,
      credentialConfigurationId: CREDENTIALS.rica,
      issuerKeyId: `${this.ctx.tenantPath}.${RESOURCES.kms}.fnb-signing-key`,
      credentialData: {
        simNumber: '89270123456789012345',
        registeredAddress: '123 Main St, Cape Town, 8001',
        verificationDate: '2024-01-15',
        status: 'Verified',
      },
    };
    
    this.saveJson('create-rica-profile-request.json', request);
    
    try {
      const response = await this.orgClient.post(
        `/v2/${issuerPath}.${profileId}/issuer-service-api/credentials/profiles`,
        request
      );
      this.saveJson('create-rica-profile-response.json', response.data);
      console.log(`   [OK] RICACredential profile created: ${issuerPath}.${profileId}`);
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`   [OK] RICACredential profile already exists`);
      } else {
        throw error;
      }
    }
  }

  async createEmployeeStatusOffer() {
    this.log('Create EmployeeStatusCredential offer');
    const issuerPath = `${this.config.organization}.${this.config.tenant}.${RESOURCES.persal}`;
    const profileId = 'employee-profile';
    
    const request = {
      authMethod: 'PRE_AUTHORIZED',
    };
    
    this.saveJson('create-employee-offer-request.json', request);
    
    try {
      const response = await this.orgClient.post(
        `/v2/${issuerPath}.${profileId}/issuer-service-api/credentials/offers`,
        request
      );
      this.ctx.employeeOfferUrl = response.data.credentialOffer;
      this.saveJson('create-employee-offer-response.json', response.data);
      console.log(`   [OK] EmployeeStatusCredential offer created`);
    } catch (error: any) {
      console.log(`   [WARN] Failed to create EmployeeStatusCredential offer: ${error.message}`);
      throw error;
    }
  }

  async createSAIDOffer() {
    this.log('Create SAIDCredential offer');
    const issuerPath = `${this.config.organization}.dha.${RESOURCES.dha}`;
    const profileId = 'said-profile';
    
    const request = {
      authMethod: 'PRE_AUTHORIZED',
    };
    
    this.saveJson('create-said-offer-request.json', request);
    
    try {
      const response = await this.orgClient.post(
        `/v2/${issuerPath}.${profileId}/issuer-service-api/credentials/offers`,
        request
      );
      this.ctx.saidOfferUrl = response.data.credentialOffer;
      this.saveJson('create-said-offer-response.json', response.data);
      console.log(`   [OK] SAIDCredential offer created`);
    } catch (error: any) {
      console.log(`   [WARN] Failed to create SAIDCredential offer: ${error.message}`);
      throw error;
    }
  }

  async createTaxRegistrationOffer() {
    this.log('Create TaxRegistrationCredential offer');
    const issuerPath = `${this.config.organization}.sars.${RESOURCES.sars}`;
    const profileId = 'tax-profile';
    
    const request = {
      authMethod: 'PRE_AUTHORIZED',
    };
    
    this.saveJson('create-tax-offer-request.json', request);
    
    try {
      const response = await this.orgClient.post(
        `/v2/${issuerPath}.${profileId}/issuer-service-api/credentials/offers`,
        request
      );
      this.ctx.taxOfferUrl = response.data.credentialOffer;
      this.saveJson('create-tax-offer-response.json', response.data);
      console.log(`   [OK] TaxRegistrationCredential offer created`);
    } catch (error: any) {
      console.log(`   [WARN] Failed to create TaxRegistrationCredential offer: ${error.message}`);
      throw error;
    }
  }

  async createBankAccountOffer() {
    this.log('Create BankAccountCredential offer');
    const issuerPath = `${this.config.organization}.fnb.${RESOURCES.fnb}`;
    const profileId = 'bank-account-profile';
    
    const request = {
      authMethod: 'PRE_AUTHORIZED',
    };
    
    this.saveJson('create-bank-account-offer-request.json', request);
    
    try {
      const response = await this.orgClient.post(
        `/v2/${issuerPath}.${profileId}/issuer-service-api/credentials/offers`,
        request
      );
      this.ctx.bankAccountOfferUrl = response.data.credentialOffer;
      this.saveJson('create-bank-account-offer-response.json', response.data);
      console.log(`   [OK] BankAccountCredential offer created`);
    } catch (error: any) {
      console.log(`   [WARN] Failed to create BankAccountCredential offer: ${error.message}`);
      throw error;
    }
  }

  async createRICAOffer() {
    this.log('Create RICACredential offer');
    const issuerPath = `${this.config.organization}.fnb.${RESOURCES.fnb}`;
    const profileId = 'rica-profile';
    
    const request = {
      authMethod: 'PRE_AUTHORIZED',
    };
    
    this.saveJson('create-rica-offer-request.json', request);
    
    try {
      const response = await this.orgClient.post(
        `/v2/${issuerPath}.${profileId}/issuer-service-api/credentials/offers`,
        request
      );
      this.ctx.ricaOfferUrl = response.data.credentialOffer;
      this.saveJson('create-rica-offer-response.json', response.data);
      console.log(`   [OK] RICACredential offer created`);
    } catch (error: any) {
      console.log(`   [WARN] Failed to create RICACredential offer: ${error.message}`);
      throw error;
    }
  }

  async createVerificationSession() {
    this.log('Create DigiGov verification session (all 5 credentials)');
    
    // Build VC policies list
    const vcPolicies: any[] = [
      {
        policy: 'signature',
      },
    ];
    
    // Add ETSI trust list policy if enabled
    if (this.config.useEtsiTrustList && this.config.trustRegistryUrl) {
      vcPolicies.push({
        policy: 'etsi-trust-list',
        trustRegistryUrl: this.config.trustRegistryUrl,
      });
    }
    
    const request = {
      flow_type: 'cross_device',
      core_flow: {
        dcql_query: {
          credentials: [
            {
              id: 'employee_status',
              format: 'jwt_vc_json',
              meta: {},
              claims: [
                { path: ['vc', 'credentialSubject', 'employeeId'] },
                { path: ['vc', 'credentialSubject', 'department'] },
                { path: ['vc', 'credentialSubject', 'position'] },
                { path: ['vc', 'credentialSubject', 'clearanceLevel'] },
              ],
            },
            {
              id: 'national_id',
              format: 'jwt_vc_json',
              meta: {},
              claims: [
                { path: ['vc', 'credentialSubject', 'idNumber'] },
                { path: ['vc', 'credentialSubject', 'firstName'] },
                { path: ['vc', 'credentialSubject', 'lastName'] },
                { path: ['vc', 'credentialSubject', 'dateOfBirth'] },
                { path: ['vc', 'credentialSubject', 'nationality'] },
              ],
            },
            {
              id: 'tax_registration',
              format: 'jwt_vc_json',
              meta: {},
              claims: [
                { path: ['vc', 'credentialSubject', 'taxNumber'] },
                { path: ['vc', 'credentialSubject', 'status'] },
                { path: ['vc', 'credentialSubject', 'validUntil'] },
              ],
            },
            {
              id: 'bank_account',
              format: 'jwt_vc_json',
              meta: {},
              claims: [
                { path: ['vc', 'credentialSubject', 'accountNumber'] },
                { path: ['vc', 'credentialSubject', 'accountType'] },
                { path: ['vc', 'credentialSubject', 'branchCode'] },
                { path: ['vc', 'credentialSubject', 'accountHolder'] },
              ],
            },
            {
              id: 'rica',
              format: 'jwt_vc_json',
              meta: {},
              claims: [
                { path: ['vc', 'credentialSubject', 'simNumber'] },
                { path: ['vc', 'credentialSubject', 'registeredAddress'] },
                { path: ['vc', 'credentialSubject', 'verificationDate'] },
                { path: ['vc', 'credentialSubject', 'status'] },
              ],
            },
          ],
        },
        policies: {
          vc_policies: vcPolicies,
        },
      },
    };
    
    this.saveJson('verification-session-request.json', request);
    
    const response = await this.orgClient.post(
      `/v1/${this.ctx.tenantPath}.${RESOURCES.digigov}/verifier2-service-api/verification-session/create`,
      request
    );
    
    this.ctx.verificationSessionId = response.data.sessionId;
    this.ctx.verificationRequestUrl = response.data.bootstrapAuthorizationRequestUrl;
    this.saveJson('verification-session-response.json', response.data);
    
    const policyDesc = this.config.useEtsiTrustList 
      ? 'signature + ETSI trust list' 
      : 'signature only';
    console.log(`   [OK] Verification session created (ID: ${this.ctx.verificationSessionId})`);
    console.log(`        Policies: ${policyDesc}`);
  }
}

// ============================================================================
// System Initialization
// ============================================================================
class SystemInit {
  private client: HttpClient;
  private config: Config;
  private adminBaseUrl: string;
  private superadminAuthToken: string = '';

  constructor(config: Config) {
    this.config = config;
    this.client = new HttpClient(`http://${config.baseUrl}:${config.port}`);
    this.adminBaseUrl = `http://enterprise.localhost:${config.port}`;
  }

  async createSuperadmin() {
    console.log('\n>> Creating superadmin account');
    
    // Read superadmin config
    const configPath = join(__dirname, '../config/superadmin-registration.conf');
    let token = this.config.superadminToken;
    let email = this.config.email;
    let password = this.config.password;
    
    if (!token && existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      // Parse HOCON format: "token-value": { ... }
      const tokenMatch = content.match(/"([^"]+)":\s*{/);
      const emailMatch = content.match(/email\s*=\s*"([^"]+)"/);
      const passwordMatch = content.match(/password\s*=\s*"([^"]+)"/);
      
      if (tokenMatch) token = tokenMatch[1];
      if (emailMatch) email = emailMatch[1];
      if (passwordMatch) password = passwordMatch[1];
      
      console.log(`   [INFO] Using credentials from: ${configPath}`);
    }
    
    if (!token) {
      throw new Error('Superadmin token not found. Set SUPERADMIN_TOKEN or configure superadmin-registration.conf');
    }
    
    try {
      await this.client.post('/v1/superadmin/create-by-token', {
        token,
        email,
        password,
      });
      console.log('   [OK] Superadmin account created');
    } catch (error: any) {
      if (error.message?.includes('already exists') || 
          error.message?.includes('Invalid token') ||
          error.message?.includes('No such token')) {
        console.log('   [OK] Superadmin already exists or token already used');
      } else {
        throw error;
      }
    }
  }

  async superadminLogin(): Promise<string> {
    if (this.superadminAuthToken) {
      return this.superadminAuthToken;
    }

    const response = await fetch(`${this.adminBaseUrl}/auth/account/emailpass`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: this.config.email,
        password: this.config.password,
      }),
    });
    
    const text = await response.text();
    
    try {
      const data = text ? JSON.parse(text) : {};
      this.superadminAuthToken = data.token || data.accessToken || '';
    } catch {
      console.log(`   [WARN] Superadmin login response: ${text}`);
      this.superadminAuthToken = '';
    }
    
    if (!this.superadminAuthToken) {
      throw new Error(`Failed to get superadmin auth token. Response: ${text}`);
    }
    
    return this.superadminAuthToken;
  }

  async createOrganization() {
    console.log(`\n>> Creating organization: ${this.config.organization}`);
    
    if (!this.superadminAuthToken) {
      await this.superadminLogin();
    }
    
    const response = await fetch(`${this.adminBaseUrl}/v1/admin/organizations`, {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'Authorization': `Bearer ${this.superadminAuthToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        _id: this.config.organization,
        profile: {
          name: `${this.config.organization} Organization`,
        },
      }),
    });
    
    const text = await response.text();
    
    if (text.includes('already') || text.includes('exists') || text.includes('DuplicateTarget')) {
      console.log(`   [WARN] Organization '${this.config.organization}' already exists`);
    } else if (text.includes('Unknown host alias')) {
      console.log(`   [WARN] Organization created but host alias not configured`);
      console.log(`          Configure '${this.config.organization}.enterprise.localhost' in server settings`);
    } else if (!response.ok) {
      console.log(`   [WARN] Organization creation returned: ${text}`);
    } else {
      console.log(`   [OK] Organization '${this.config.organization}' created`);
    }
  }

  async run() {
    console.log('\n' + '='.repeat(60));
    console.log('SYSTEM INITIALIZATION');
    console.log('='.repeat(60));
    
    await this.createSuperadmin();
    await this.createOrganization();
    
    console.log('\n' + '='.repeat(60));
    console.log('[SUCCESS] System initialization complete!\n');
  }
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  const args = process.argv.slice(2);
  
  const config: Config = {
    baseUrl: process.env.BASE_URL || 'enterprise.localhost',
    organization: process.env.ORGANIZATION || 'friends',
    tenant: process.env.TENANT || 'treasury',
    email: process.env.EMAIL || 'superadmin@walt.id',
    password: process.env.PASSWORD || 'super123456',
    port: parseInt(process.env.PORT || '3000'),
    superadminToken: process.env.SUPERADMIN_TOKEN,
    useEtsiTrustList: false,  // Default: disabled
    trustRegistryUrl: process.env.TRUST_REGISTRY_URL || 'http://127.0.0.1:7005',
  };
  
  // Handle --etsi-trust-list flag
  if (args.includes('--etsi-trust-list')) {
    config.useEtsiTrustList = true;
  }
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
South African Government Demo - Complete Journey Test

Usage:
  npx tsx e2e/journey-sa-gov.ts [options]

Options:
  --init-system             Initialize system (create superadmin + organization)
  --create-organization     Create organization only
  --etsi-trust-list         Enable ETSI Trust List validation (requires external trust registry)
  --help, -h                Show this help

Environment Variables:
  BASE_URL                  Enterprise stack base URL (default: enterprise.localhost)
  PORT                      Port number (default: 3000)
  ORGANIZATION              Organization ID (default: friends)
  TENANT                    Tenant ID (default: treasury)
  EMAIL                     Admin email (default: superadmin@walt.id)
  PASSWORD                  Admin password (default: super123456)
  SUPERADMIN_TOKEN          Superadmin registration token
  TRUST_REGISTRY_URL        URL of external trust registry service (default: http://127.0.0.1:7005)

Examples:
  # Full system init
  npx tsx e2e/journey-sa-gov.ts --init-system
  
  # Run the journey test (signature policy only)
  npx tsx e2e/journey-sa-gov.ts
  
  # Run with ETSI Trust List (requires external trust registry running)
  TRUST_REGISTRY_URL=http://localhost:7005 npx tsx e2e/journey-sa-gov.ts --etsi-trust-list
`);
    return;
  }
  
  if (args.includes('--init-system')) {
    const init = new SystemInit(config);
    await init.run();
    return;
  }
  
  if (args.includes('--create-organization')) {
    const init = new SystemInit(config);
    await init.createOrganization();
    return;
  }
  
  const journey = new SAGovJourney(config);
  await journey.run();
}

main().catch((error) => {
  console.error('\nFatal error:', error);
  process.exit(1);
});
