// Thrown by normalizeEgyptianMobile. Framework agnostic; the global
// exception filter turns it into a 400 response.
export class InvalidPhoneNumberError extends Error {
  constructor(readonly input: string) {
    super(
      'Phone must be an Egyptian mobile number (010, 011, 012 or 015 followed by 8 digits)',
    );
    this.name = 'InvalidPhoneNumberError';
  }
}
