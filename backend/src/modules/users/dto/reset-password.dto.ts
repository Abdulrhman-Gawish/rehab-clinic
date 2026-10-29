import { PasswordField } from './user-fields.js';

export class ResetPasswordDto {
  @PasswordField()
  newPassword: string;
}
