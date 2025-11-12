import { IsString, IsNotEmpty, IsISO8601, MinLength, MaxLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { TimezoneUtil } from '../../../common/utils/timezone.util';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(255)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(255)
  lastName: string;

  @IsISO8601({ strict: false })
  birthday: string;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => {
    if (!TimezoneUtil.isValidTimezone(value)) {
      throw new Error(`Invalid timezone: ${value}. Must be a valid IANA timezone (e.g., America/New_York)`);
    }
    return value;
  })
  timezone: string;
}
