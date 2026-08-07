import { IsString, MaxLength } from 'class-validator';
import { MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH } from '@app/accounts';

/**
 * The two JSON bodies this application accepts, and the decorators that make
 * them safe.
 *
 * `@IsString()` ON EVERY FIELD IS LOAD-BEARING, NOT DECORATIVE. Without it,
 * `{"email": {"$gt": ""}}` arrives as an object, reaches `findOne({email})` as
 * a Mongo operator, and matches the FIRST USER IN THE COLLECTION — the classic
 * NoSQL authentication bypass. The `ValidationPipe` is configured with
 * `whitelist: true` and `forbidNonWhitelisted: true` for the other half of it:
 * `whitelist` strips fields no DTO declares, so a body cannot smuggle
 * `passwordHash` or `failedLoginCount` into anything that spreads it.
 *
 * The length bounds are the same ones the pure units enforce, restated here so
 * a 10 KB password is refused BEFORE it costs an argon2 hash.
 */

export class CredentialsDto {
  @IsString()
  @MaxLength(MAX_EMAIL_LENGTH)
  email!: string;

  @IsString()
  @MaxLength(MAX_PASSWORD_LENGTH)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(MAX_PASSWORD_LENGTH)
  current!: string;

  @IsString()
  @MaxLength(MAX_PASSWORD_LENGTH)
  next!: string;
}
