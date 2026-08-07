import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { IdentityRepository } from './identity.repository.js';
import { Argon2PasswordHasher, IdentityService } from './identity.service.js';
import { RedisLoginRateLimiter } from './login-rate-limiter.js';
import { MailpitVerificationSender } from './notification.provider.js';
import { SessionService } from './session.service.js';
import { VerificationService } from './verification.service.js';

@Module({
  imports: [PlatformModule],
  controllers: [AuthController],
  providers: [
    IdentityRepository,
    Argon2PasswordHasher,
    RedisLoginRateLimiter,
    MailpitVerificationSender,
    VerificationService,
    SessionService,
    IdentityService,
    AuthGuard,
    { provide: 'SESSION_STORE', useExisting: IdentityRepository },
    { provide: 'VERIFICATION_STORE', useExisting: IdentityRepository },
    { provide: 'VERIFICATION_SENDER', useExisting: MailpitVerificationSender },
    { provide: 'IDENTITY_DATA_STORE', useExisting: IdentityRepository },
    { provide: 'PASSWORD_HASHER', useExisting: Argon2PasswordHasher },
    { provide: 'IDENTITY_VERIFICATION', useExisting: VerificationService },
    { provide: 'SESSION_ISSUER', useExisting: SessionService },
    { provide: 'LOGIN_RATE_LIMITER', useExisting: RedisLoginRateLimiter },
  ],
  exports: [IdentityService, SessionService, AuthGuard],
})
export class IdentityModule {}
