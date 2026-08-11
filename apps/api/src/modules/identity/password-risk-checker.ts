import { RecaptchaEnterpriseServiceClient } from '@google-cloud/recaptcha-enterprise';
import { PasswordCheckVerification } from 'recaptcha-password-check-helpers';

export const PASSWORD_RISK_CHECKER = Symbol('PASSWORD_RISK_CHECKER');

export type PasswordRiskVerdict = 'safe' | 'compromised';

export interface PasswordRiskChecker {
  check(identity: string, password: string): Promise<PasswordRiskVerdict>;
}

export class PasswordRiskCheckUnavailableError extends Error {
  constructor() {
    super('Password risk check is temporarily unavailable');
    this.name = 'PasswordRiskCheckUnavailableError';
  }
}

type Verification = {
  getLookupHashPrefix(): Uint8Array;
  getEncryptedUserCredentialsHash(): Uint8Array;
  verify(reencryptedHash: Uint8Array, encryptedPrefixes: Uint8Array[]): boolean | { areCredentialsLeaked(): boolean };
};

type AssessmentResponse = {
  privatePasswordLeakVerification?: {
    reencryptedUserCredentialsHash?: Uint8Array | Buffer | string | null;
    encryptedLeakMatchPrefixes?: Uint8Array[] | null;
  } | null;
};

type GoogleDependencies = {
  createVerification(identity: string, password: string): Promise<Verification>;
  createAssessment(request: {
    parent: string;
    assessment: {
      privatePasswordLeakVerification: {
        lookupHashPrefix: Uint8Array;
        encryptedUserCredentialsHash: Uint8Array;
      };
    };
  }): Promise<[AssessmentResponse, ...unknown[]]>;
};

export class DevelopmentPasswordRiskChecker implements PasswordRiskChecker {
  async check(_identity: string, _password: string): Promise<PasswordRiskVerdict> {
    return 'safe';
  }
}

export class GooglePasswordRiskChecker implements PasswordRiskChecker {
  private readonly dependencies: GoogleDependencies;

  constructor(
    private readonly config: { projectId: string; timeoutMs: number },
    dependencies?: GoogleDependencies,
  ) {
    if (dependencies) {
      this.dependencies = dependencies;
      return;
    }

    const client = new RecaptchaEnterpriseServiceClient();
    this.dependencies = {
      createVerification: PasswordCheckVerification.create,
      createAssessment: async (request) => client.createAssessment(request),
    };
  }

  async check(identity: string, password: string): Promise<PasswordRiskVerdict> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = this.checkWithGoogle(identity, password);
      const timeoutOperation = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new PasswordRiskCheckUnavailableError()), this.config.timeoutMs);
      });
      return await Promise.race([operation, timeoutOperation]);
    } catch {
      throw new PasswordRiskCheckUnavailableError();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async checkWithGoogle(identity: string, password: string): Promise<PasswordRiskVerdict> {
    const verification = await this.dependencies.createVerification(identity, password);
    const [response] = await this.dependencies.createAssessment({
      parent: `projects/${this.config.projectId}`,
      assessment: {
        privatePasswordLeakVerification: {
          lookupHashPrefix: verification.getLookupHashPrefix(),
          encryptedUserCredentialsHash: verification.getEncryptedUserCredentialsHash(),
        },
      },
    });
    const result = response.privatePasswordLeakVerification;
    if (!result?.reencryptedUserCredentialsHash || !result.encryptedLeakMatchPrefixes) {
      throw new PasswordRiskCheckUnavailableError();
    }
    const hash = toUint8Array(result.reencryptedUserCredentialsHash);
    const verdict = verification.verify(hash, result.encryptedLeakMatchPrefixes);
    const compromised = typeof verdict === 'boolean' ? verdict : verdict.areCredentialsLeaked();
    return compromised ? 'compromised' : 'safe';
  }
}

function toUint8Array(value: Uint8Array | Buffer | string): Uint8Array {
  if (typeof value === 'string') return Uint8Array.from(Buffer.from(value, 'base64'));
  return Uint8Array.from(value);
}
