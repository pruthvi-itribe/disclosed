import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH } from '@app/accounts';

/**
 * The three JSON bodies this application accepts, and the decorators that make
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

  /**
   * 'bearer' asks for the session token in the response body — the one
   * transport a WebView shell can use, because SameSite=Lax rightly keeps
   * the cookie from crossing capacitor:// to the API origin. Allowlisted
   * to the single value; anything else is a 400, not a silent cookie.
   */
  @IsOptional()
  @IsIn(['bearer'])
  transport?: 'bearer';
}

/**
 * The longest ID token accepted.
 *
 * A Firebase ID token is a three-part RS256 JWT and runs about 900-1,200
 * characters; 4,096 is generous by three or four times and still bounds what an
 * unauthenticated caller can make the verifier parse. It sits under the 4 KB
 * body limit `dashboard.module.ts` mounts, so an oversized token is refused by
 * the body parser first and by this second — two bounds, neither redundant,
 * because they fail at different layers with different messages.
 */
export const MAX_ID_TOKEN_LENGTH = 4_096;

export class FirebaseTokenDto {
  // `@IsString()` for the same reason as every other field here: without it
  // `{"idToken": {"$gt": ""}}` arrives as an object, and an object reaching a
  // JWT parser is at best a 500 and at worst an argument about what `split('.')`
  // does to something that is not a string.
  @IsString()
  @MaxLength(MAX_ID_TOKEN_LENGTH)
  idToken!: string;

  /** See CredentialsDto.transport — the shell's door asks the same way. */
  @IsOptional()
  @IsIn(['bearer'])
  transport?: 'bearer';
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(MAX_PASSWORD_LENGTH)
  current!: string;

  @IsString()
  @MaxLength(MAX_PASSWORD_LENGTH)
  next!: string;
}
